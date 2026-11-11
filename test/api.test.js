import test from 'node:test';
import assert from 'node:assert/strict';

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
  await migrate(pool);
  await migrate(pool); // A second startup must not recreate or clear the data.
  let running = await start();
  t.after(() => close(running.server));
  const json = (method, body) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  assert.equal((await fetch(`${running.base}/ready`)).status, 200);
  assert.equal(
    (await fetch(`${running.base}/api/tasks`, json('POST', { title: '  ' })))
      .status,
    400
  );
  assert.equal(
    (
      await fetch(`${running.base}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{'
      })
    ).status,
    400
  );
  const streamAbort = new AbortController();
  t.after(() => streamAbort.abort());
  const eventResponse = await fetch(`${running.base}/api/events`, {
    signal: streamAbort.signal
  });
  assert.match(eventResponse.headers.get('content-type'), /text\/event-stream/);
  const reader = eventResponse.body.getReader();
  assert.match(
    new TextDecoder().decode((await reader.read()).value),
    /event: connected/
  );
  const created = await fetch(
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
      await fetch(
        `${running.base}/api/tasks/${task.id}`,
        json('PATCH', { completed: 'yes' })
      )
    ).status,
    400
  );
  await close(running.server);
  running = await start();
  const persisted = await fetch(`${running.base}/api/tasks/${task.id}`);
  assert.equal(persisted.status, 200);
  assert.equal((await persisted.json()).title, task.title);
  const updated = await fetch(
    `${running.base}/api/tasks/${task.id}`,
    json('PATCH', { completed: true })
  );
  assert.equal((await updated.json()).completed, true);
  assert.equal(
    (await (await fetch(`${running.base}/api/tasks/${task.id}`)).json())
      .completed,
    true
  );
  assert.equal(
    (await fetch(`${running.base}/api/tasks/${task.id}`, { method: 'DELETE' }))
      .status,
    204
  );
  assert.equal(
    (await fetch(`${running.base}/api/tasks/${task.id}`)).status,
    404
  );
});
