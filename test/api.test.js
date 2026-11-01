import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('task lifecycle and invalid input over HTTP', async (t) => {
  const server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.deepEqual(await (await fetch(`${base}/tasks`)).json(), []);
  assert.equal((await fetch(`${base}/tasks`, json('POST', { title: '  ' }))).status, 400);
  assert.equal((await fetch(`${base}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  const created = await fetch(`${base}/tasks`, json('POST', { title: 'Learn Docker' }));
  assert.equal(created.status, 201);
  const task = await created.json();
  assert.equal(task.completed, false);
  assert.equal((await (await fetch(`${base}/tasks`)).json()).length, 1);
  assert.equal((await fetch(`${base}/tasks/${task.id}`, json('PATCH', { completed: 'yes' }))).status, 400);
  const updated = await fetch(`${base}/tasks/${task.id}`, json('PATCH', { completed: true }));
  assert.equal((await updated.json()).completed, true);
  assert.equal((await fetch(`${base}/tasks/${task.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${base}/tasks/${task.id}`)).status, 404);
  assert.deepEqual(await (await fetch(`${base}/tasks`)).json(), []);
});
