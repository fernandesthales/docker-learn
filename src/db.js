import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
  statement_timeout: 5000,
  max: 5
});

pool.on('error', (error) => {
  console.error('Unexpected database connection error:', error);
});

const columns = `
  id,
  title,
  completed,
  to_char(due_date, 'YYYY-MM-DD') AS "dueDate",
  priority,
  description,
  created_at AS "createdAt"
`;

export async function listTasks(userId) {
  const result = await pool.query(
    `
    SELECT ${columns}
    FROM tasks WHERE user_id = $1
    ORDER BY created_at, id
  `,
    [userId]
  );

  return result.rows;
}

export async function getTask(id, userId) {
  const result = await pool.query(
    `SELECT ${columns} FROM tasks WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );

  return result.rows[0];
}

export async function saveTask(task, userId) {
  await pool.query(
    `INSERT INTO tasks (id, title, completed, created_at, user_id, due_date, priority, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      task.id,
      task.title,
      task.completed,
      task.createdAt,
      userId,
      task.dueDate,
      task.priority,
      task.description
    ]
  );
}

export async function updateTask(id, changes, userId) {
  // SQL identifiers come only from this allowlist; all user values are parameters.
  // Update only submitted fields so a checkbox change cannot overwrite edited details.
  const fields = {
    title: 'title',
    completed: 'completed',
    dueDate: 'due_date',
    priority: 'priority',
    description: 'description'
  };
  const entries = Object.entries(changes).filter(([key]) =>
    Object.hasOwn(fields, key)
  );
  if (!entries.length) throw new Error('No task fields to update');
  const assignments = entries
    .map(([key], index) => `${fields[key]} = $${index + 3}`)
    .join(', ');
  const result = await pool.query(
    `UPDATE tasks SET ${assignments} WHERE id = $1 AND user_id = $2 RETURNING ${columns}`,
    [id, userId, ...entries.map(([, value]) => value)]
  );
  return result.rows[0];
}

export async function deleteTask(id, userId) {
  await pool.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [
    id,
    userId
  ]);
}

const userColumns = `id, name, email, age, created_at AS "createdAt", updated_at AS "updatedAt"`;
export async function createUser(user) {
  const result = await pool.query(
    `INSERT INTO users (id, name, email, age, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING ${userColumns}`,
    [user.id, user.name, user.email, user.age, user.passwordHash]
  );
  return result.rows[0];
}
export async function findUserByEmail(email) {
  const result = await pool.query(
    `SELECT ${userColumns}, password_hash AS "passwordHash" FROM users WHERE email = $1`,
    [email]
  );
  return result.rows[0];
}
export async function getUser(id) {
  const result = await pool.query(
    `SELECT ${userColumns} FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0];
}
