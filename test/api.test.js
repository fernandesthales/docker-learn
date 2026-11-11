import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const url = new URL(process.env.DATABASE_URL);
if (process.env.APP_ENV !== 'test' || url.pathname !== '/tasks_test')
  throw new Error('Use the dedicated test database');
const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db.js');
const { migrate } = await import('../src/migrate.js');

const start = async () => {
  const server = createApp();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
};
const close = async (server) => {
  server.closeStreams();
  await new Promise((resolve) => server.close(resolve));
};

test('PostgreSQL lifecycle, validation, live event and persistence across API replacement', async (t) => {
  t.after(() => pool.end());
  await pool.query(
    await readFile(
      new URL('../migrations/001_tasks.sql', import.meta.url),
      'utf8'
    )
  );
  await pool.query(
    "INSERT INTO tasks (id, title) VALUES ('legacy-task', 'Old shared task')"
  );
  await migrate(pool);
  assert.equal(
    (await pool.query("SELECT user_id FROM tasks WHERE id = 'legacy-task'"))
      .rows[0].user_id,
    null
  );
  await migrate(pool); // A second startup must not recreate or clear the data.
  let running = await start();
  t.after(() => close(running.server));
  let cookie;
  const request = (url, options = {}) =>
    fetch(url, {
      ...options,
      headers: {
        Origin: process.env.PUBLIC_ORIGIN,
        Cookie: cookie || '',
        ...options.headers
      }
    });
  const signup = await request(`${running.base}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Alice',
      email: 'alice@example.com',
      age: 29,
      password: 'alice-password-123'
    })
  });
  assert.equal(signup.status, 201);
  cookie = signup.headers.get('set-cookie').split(';')[0];
  const alice = await signup.json();
  assert.equal(alice.user.age, 29);
  assert.equal(alice.user.passwordHash, undefined);
  assert.deepEqual(
    await (await request(`${running.base}/api/tasks`)).json(),
    []
  );
  assert.equal(
    (await request(`${running.base}/api/tasks/legacy-task`)).status,
    404
  );
  const json = (method, body) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  assert.equal((await request(`${running.base}/ready`)).status, 200);
  assert.equal(
    (await request(`${running.base}/api/tasks`, json('POST', { title: '  ' })))
      .status,
    400
  );
  assert.equal(
    (
      await request(`${running.base}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{'
      })
    ).status,
    400
  );
  const streamAbort = new AbortController();
  t.after(() => streamAbort.abort());
  const eventResponse = await request(`${running.base}/api/events`, {
    signal: streamAbort.signal
  });
  assert.match(eventResponse.headers.get('content-type'), /text\/event-stream/);
  const reader = eventResponse.body.getReader();
  assert.match(
    new TextDecoder().decode((await reader.read()).value),
    /event: connected/
  );
  const created = await request(
    `${running.base}/api/tasks`,
    json('POST', { title: 'Persistent live task' })
  );
  assert.equal(created.status, 201);
  const task = await created.json();
  const eventTimeout = setTimeout(() => streamAbort.abort(), 5000);
  try {
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /event: tasks/
    );
  } finally {
    clearTimeout(eventTimeout);
    await reader.cancel();
  }
  assert.equal(
    (
      await request(
        `${running.base}/api/tasks/${task.id}`,
        json('PATCH', { completed: 'yes' })
      )
    ).status,
    400
  );
  const aliceCookie = cookie;
  const second = await request(
    `${running.base}/api/register`,
    json('POST', {
      name: 'Bob',
      email: 'bob@example.com',
      password: 'bob-password-123'
    })
  );
  assert.equal(second.status, 201);
  cookie = second.headers.get('set-cookie').split(';')[0];
  assert.deepEqual(
    await (await request(`${running.base}/api/tasks`)).json(),
    []
  );
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    const options =
      method === 'PATCH' ? json(method, { completed: true }) : { method };
    assert.equal(
      (await request(`${running.base}/api/tasks/${task.id}`, options)).status,
      404
    );
  }
  const bobCookie = cookie;
  const bobAbort = new AbortController();
  t.after(() => bobAbort.abort());
  const bobStream = await request(`${running.base}/api/events`, {
    signal: bobAbort.signal
  });
  const bobReader = bobStream.body.getReader();
  await bobReader.read(); // connected event
  let bobReceivedEvent = false;
  const nextBobEvent = bobReader.read().then((result) => {
    bobReceivedEvent = true;
    return result;
  });
  cookie = aliceCookie;
  await request(
    `${running.base}/api/tasks/${task.id}`,
    json('PATCH', { completed: false })
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(bobReceivedEvent, false, 'Alice mutations must not notify Bob');
  cookie = bobCookie;
  const otherTask = await (
    await request(
      `${running.base}/api/tasks`,
      json('POST', { title: 'Bob only', userId: alice.user.id })
    )
  ).json();
  const bobTimeout = setTimeout(() => bobAbort.abort(), 5000);
  try {
    assert.match(
      new TextDecoder().decode((await nextBobEvent).value),
      /event: tasks/
    );
  } finally {
    clearTimeout(bobTimeout);
    await bobReader.cancel();
  }
  cookie = aliceCookie;
  assert.equal(
    (await request(`${running.base}/api/tasks/${otherTask.id}`)).status,
    404
  );
  const duplicate = await request(
    `${running.base}/api/register`,
    json('POST', {
      name: 'Other',
      email: ' ALICE@EXAMPLE.COM ',
      password: 'other-password-123'
    })
  );
  assert.equal(duplicate.status, 409);
  assert.equal(
    (
      await request(
        `${running.base}/api/login`,
        json('POST', { email: 'alice@example.com', password: 'wrong' })
      )
    ).status,
    401
  );
  const login = await request(
    `${running.base}/api/login`,
    json('POST', {
      email: ' ALICE@EXAMPLE.COM ',
      password: 'alice-password-123'
    })
  );
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (
      await request(`${running.base}/api/tasks`, {
        ...json('POST', { title: 'bad origin' }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.test'
        }
      })
    ).status,
    403
  );
  assert.equal((await fetch(`${running.base}/api/tasks`)).status, 401);
  assert.equal((await fetch(`${running.base}/api/events`)).status, 401);
  await close(running.server);
  running = await start();
  const persisted = await request(`${running.base}/api/tasks/${task.id}`);
  assert.equal(persisted.status, 200);
  assert.equal((await persisted.json()).title, task.title);
  const updated = await request(
    `${running.base}/api/tasks/${task.id}`,
    json('PATCH', { completed: true })
  );
  assert.equal((await updated.json()).completed, true);
  assert.equal(
    (await (await request(`${running.base}/api/tasks/${task.id}`)).json())
      .completed,
    true
  );
  assert.equal(
    (
      await request(`${running.base}/api/tasks/${task.id}`, {
        method: 'DELETE'
      })
    ).status,
    204
  );
  assert.equal(
    (await request(`${running.base}/api/tasks/${task.id}`)).status,
    404
  );
  const logout = await request(`${running.base}/api/logout`, {
    method: 'POST'
  });
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  cookie = '';
  assert.equal((await request(`${running.base}/api/session`)).status, 200);
  assert.equal(
    (await request(`${running.base}/api/session`).then((r) => r.json()))
      .authenticated,
    false
  );
});
