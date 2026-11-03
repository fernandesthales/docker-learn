import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, hashPassword } from '../src/auth.js';
const env = { APP_ENV: 'test', PUBLIC_ORIGIN: 'https://board.test', SESSION_SECRET: 'test-secret-longer-than-thirty-two-characters', AUTH_PASSWORD_HASH: hashPassword('correct-password') };

test('password verification and signed, secure session cookies', () => {
  const auth = createAuth(env);
  assert.equal(auth.verifyPassword('wrong'), false);
  assert.equal(auth.verifyPassword('correct-password'), true);
  const cookie = auth.issueCookie();
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
  assert.equal(auth.loggedIn({ headers: { cookie } }), true);
  assert.equal(auth.loggedIn({ headers: { cookie: cookie.replace('task_session=', 'task_session=x') } }), false);
  assert.equal(auth.loggedIn({ headers: {} }), false);
  assert.equal(auth.validOrigin({ headers: { origin: 'https://attacker.test' } }), false);
  assert.equal(auth.validOrigin({ headers: { origin: env.PUBLIC_ORIGIN } }), true);
});

test('hosted environments fail closed without secrets and cannot bypass login', () => {
  for (const APP_ENV of ['dev', 'stage', 'prod']) {
    assert.throws(() => createAuth({ APP_ENV, AUTH_DISABLED: 'true' }));
    assert.throws(() => createAuth({ APP_ENV }));
  }
});

test('HTTP login, protected tasks, origin check, and logout', async t => {
  process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
  const { createApp } = await import('../src/app.js');
  const server = createApp({ env, store: { listTasks: async () => [] } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/tasks')).status, 401);
  const headers = { 'Content-Type': 'application/json', Origin: env.PUBLIC_ORIGIN };
  const login = await fetch(base + '/api/login', { method: 'POST', headers, body: JSON.stringify({ password: 'correct-password' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + '/api/tasks', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(base + '/api/tasks', { method: 'POST', headers: { ...headers, Origin: 'https://evil.test', Cookie: cookie }, body: '{}' })).status, 403);
  const logout = await fetch(base + '/api/logout', { method: 'POST', headers: { ...headers, Cookie: cookie } });
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});
