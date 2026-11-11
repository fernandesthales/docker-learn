import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(password, salt, 32)).toString('hex')}`;
}
export async function verifyPassword(password, hash) {
  if (
    typeof password !== 'string' ||
    password.length > 256 ||
    !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(hash || '')
  )
    return false;
  const [salt, expected] = hash.split(':');
  return timingSafeEqual(
    await derive(password, salt, 32),
    Buffer.from(expected, 'hex')
  );
}
export function createAuth(env = process.env) {
  if (env.AUTH_DISABLED === 'true')
    throw new Error(
      'User accounts require authentication; remove AUTH_DISABLED'
    );
  const origins = (env.PUBLIC_ORIGIN || '')
    .split(',')
    .map((value) => value.trim());
  const secret = env.SESSION_SECRET;
  if (!origins[0] || !secret || secret.length < 32)
    throw new Error('Set PUBLIC_ORIGIN and SESSION_SECRET (32+ characters)');
  const sign = (value) =>
    createHmac('sha256', secret).update(value).digest('base64url');
  const cookie = (value, age) =>
    `task_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${env.COOKIE_SECURE !== 'false' ? '; Secure' : ''}`;
  return {
    validOrigin(req) {
      return origins.includes(req.headers.origin);
    },
    userId(req) {
      const token = req.headers.cookie
        ?.split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('task_session='))
        ?.slice(13);
      if (!token) return null;
      const [payload, signature, extra] = token.split('.');
      if (!payload || !signature || extra) return null;
      const actual = Buffer.from(signature),
        expected = Buffer.from(sign(payload));
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return null;
      try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        return typeof data.userId === 'string' &&
          data.userId &&
          Number.isFinite(data.expires) &&
          data.expires > Date.now()
          ? data.userId
          : null;
      } catch {
        return null;
      }
    },
    issueCookie(userId) {
      const payload = Buffer.from(
        JSON.stringify({
          userId,
          expires: Date.now() + 12 * 3600_000,
          nonce: randomBytes(16).toString('hex')
        })
      ).toString('base64url');
      return cookie(`${payload}.${sign(payload)}`, 12 * 3600);
    },
    clearCookie() {
      return cookie('', 0);
    }
  };
}
