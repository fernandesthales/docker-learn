import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createAuth, hashPassword, verifyPassword } from '../src/auth.js';
import { validateRegistration } from '../src/user.js';
const env = {
  APP_ENV: 'test',
  PUBLIC_ORIGIN: 'https://board.test',
  SESSION_SECRET: 'test-secret-longer-than-thirty-two-characters'
};

test('password hashes and signed cookies bind sessions to users', async () => {
  const hash = await hashPassword('correct-password');
  assert.equal(await verifyPassword('wrong', hash), false);
  assert.equal(await verifyPassword('correct-password', hash), true);
  assert.notEqual(hash, await hashPassword('correct-password'));
  const auth = createAuth(env);
  const cookie = auth.issueCookie('alice');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict'])
    assert.ok(cookie.includes(flag));
  assert.equal(auth.userId({ headers: { cookie } }), 'alice');
  assert.equal(
    auth.userId({
      headers: { cookie: cookie.replace('task_session=', 'task_session=x') }
    }),
    null
  );
  assert.equal(auth.userId({ headers: {} }), null);
  const sign = (data) => {
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    return `task_session=${payload}.${createHmac('sha256', env.SESSION_SECRET).update(payload).digest('base64url')}`;
  };
  assert.equal(
    auth.userId({
      headers: { cookie: sign({ userId: 'alice', expires: Date.now() - 1 }) }
    }),
    null
  );
  assert.equal(
    auth.userId({ headers: { cookie: sign({ expires: Date.now() + 10000 }) } }),
    null
  );
  assert.equal(
    auth.validOrigin({ headers: { origin: 'https://attacker.test' } }),
    false
  );
  assert.equal(
    auth.validOrigin({ headers: { origin: env.PUBLIC_ORIGIN } }),
    true
  );
});

test('all environments require authentication configuration', () => {
  for (const APP_ENV of ['local', 'test', 'dev', 'stage', 'prod']) {
    assert.throws(() => createAuth({ ...env, APP_ENV, AUTH_DISABLED: 'true' }));
    assert.throws(() => createAuth({ APP_ENV }));
  }
});

test('profile validates and normalizes registration fields', () => {
  const good = {
    name: ' Alice ',
    email: ' ALICE@example.com ',
    password: 'long-enough-password',
    age: 25
  };
  assert.deepEqual(validateRegistration(good), {
    name: 'Alice',
    email: 'alice@example.com',
    age: 25
  });
  for (const patch of [
    { name: '' },
    { email: 'bad' },
    { password: 'tiny' },
    { password: 'x'.repeat(257) },
    { age: -1 },
    { age: 151 },
    { age: 1.5 },
    { age: '25' }
  ])
    assert.throws(
      () => validateRegistration({ ...good, ...patch }),
      { status: 400 },
      `Expected rejection for ${JSON.stringify(patch)}`
    );

  for (const length of [5, 256]) {
    assert.doesNotThrow(
      () => validateRegistration({ ...good, password: 'x'.repeat(length) }),
      `Expected a ${length}-character password to be accepted`
    );
  }
});
