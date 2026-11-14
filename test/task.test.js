import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTask } from '../src/task.js';

test('new task defaults and partial updates preserve omitted fields', () => {
  assert.deepEqual(validateTask({ title: ' Task ' }), {
    title: 'Task',
    dueDate: null,
    priority: 'medium',
    description: ''
  });
  assert.deepEqual(validateTask({ completed: true }, { partial: true }), {
    completed: true
  });
  assert.deepEqual(
    validateTask({ dueDate: null, description: '' }, { partial: true }),
    { dueDate: null, description: '' }
  );
  assert.deepEqual(
    validateTask({ priority: 'high', userId: 'other' }, { partial: true }),
    { priority: 'high' }
  );
  assert.throws(() => validateTask({ userId: 'other' }, { partial: true }), {
    status: 400
  });
});
test('dates must be real calendar dates without a time or timezone', () => {
  for (const dueDate of [
    '2028-02-29',
    '2026-11-13',
    '0001-01-01',
    '9999-12-31',
    null
  ]) {
    assert.equal(validateTask({ title: 'Task', dueDate }).dueDate, dueDate);
  }
  for (const dueDate of [
    '2027-02-29',
    '2026-02-30',
    '2026-13-01',
    '2026-00-01',
    '0000-01-01',
    '2026-1-01',
    '2026-11-13T00:00:00Z',
    '',
    123
  ]) {
    assert.throws(
      () => validateTask({ title: 'Task', dueDate }),
      { status: 400 },
      String(dueDate)
    );
  }
});
test('priority and description are validated for both creation and updates', () => {
  for (const priority of ['low', 'medium', 'high'])
    assert.equal(validateTask({ title: 'Task', priority }).priority, priority);
  assert.equal(
    validateTask({ title: 'Task', description: 'x'.repeat(2000) }).description
      .length,
    2000
  );
  for (const patch of [
    { priority: 'urgent' },
    { priority: null },
    { description: null },
    { description: 42 },
    { description: 'x'.repeat(2001) },
    { title: '' }
  ]) {
    for (const partial of [true, false])
      assert.throws(
        () => validateTask({ title: 'Task', ...patch }, { partial }),
        { status: 400 }
      );
  }
});
