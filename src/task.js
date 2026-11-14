// Share validation between creation and partial updates. Only these fields are writable.
export function validateTask(body, { partial = false } = {}) {
  const values = {};
  const invalid = (message) => {
    throw Object.assign(new Error(message), { status: 400 });
  };
  if (!partial || Object.hasOwn(body, 'title')) {
    if (
      typeof body.title !== 'string' ||
      !body.title.trim() ||
      body.title.trim().length > 200
    )
      invalid('Title must contain 1–200 characters');
    values.title = body.title.trim();
  }
  if (!partial || Object.hasOwn(body, 'description')) {
    const description = Object.hasOwn(body, 'description')
      ? body.description
      : '';
    if (typeof description !== 'string' || description.length > 2000)
      invalid('Description must be text with at most 2000 characters');
    values.description = description.trim();
  }
  if (!partial || Object.hasOwn(body, 'priority')) {
    const priority = Object.hasOwn(body, 'priority') ? body.priority : 'medium';
    if (!['low', 'medium', 'high'].includes(priority))
      invalid('Priority must be low, medium, or high');
    values.priority = priority;
  }
  if (!partial || Object.hasOwn(body, 'dueDate')) {
    const dueDate = Object.hasOwn(body, 'dueDate') ? body.dueDate : null;
    // Round-trip through UTC to reject impossible dates such as February 30.
    if (
      dueDate !== null &&
      (typeof dueDate !== 'string' ||
        !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
        !Number.isFinite(Date.parse(`${dueDate}T00:00:00Z`)) ||
        new Date(`${dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== dueDate)
    )
      invalid('Due date must be a valid YYYY-MM-DD date or null');
    values.dueDate = dueDate;
  }
  if (partial && Object.hasOwn(body, 'completed')) {
    if (typeof body.completed !== 'boolean')
      invalid('completed must be true or false');
    values.completed = body.completed;
  }
  if (partial && !Object.keys(values).length)
    invalid('Provide at least one task field to update');
  return values;
}
