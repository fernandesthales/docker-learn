import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

export function createAuth(env = process.env) {
  const disabled = env.AUTH_DISABLED === 'true';
  if (disabled && !['local', 'test'].includes(env.APP_ENV)) {
    throw new Error('AUTH_DISABLED is allowed only in local/test');
  }
  const secure = env.COOKIE_SECURE !== 'false';
  const origin = env.PUBLIC_ORIGIN;
  const secret = env.SESSION_SECRET;
  const hash = env.AUTH_PASSWORD_HASH;
  if (!disabled && (!origin || !secret || secret.length < 32 || !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(hash || ''))) {
    throw new Error('Set PUBLIC_ORIGIN, SESSION_SECRET (32+ characters), and AUTH_PASSWORD_HASH');
  }
  const sign = (value) => createHmac('sha256', secret).update(value).digest('base64url');
  const cookie = (value, age) => `task_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`;
  return {
    disabled,
    validOrigin(req) {
      return disabled || req.headers.origin === origin;
    },
    verifyPassword(password) {
      if (typeof password !== 'string' || password.length > 256) return false;
      const [salt, expected] = hash.split(':');
      return timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(expected, 'hex'));
    },
    loggedIn(req) {
      if (disabled) return true;
      const token = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('task_session='))?.slice(13);
      if (!token) return false;
      const [payload, signature, extra] = token.split('.');
      if (!payload || !signature || extra) return false;
      const actual = Buffer.from(signature);
      const expected = Buffer.from(sign(payload));
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
      try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).expires > Date.now(); }
      catch { return false; }
    },
    issueCookie() {
      const payload = Buffer.from(JSON.stringify({ expires: Date.now() + 12 * 3600_000, nonce: randomBytes(16).toString('hex') })).toString('base64url');
      return cookie(`${payload}.${sign(payload)}`, 12 * 3600);
    },
    clearCookie() { return cookie('', 0); }
  };
}
