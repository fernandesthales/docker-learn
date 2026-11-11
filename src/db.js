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
    `INSERT INTO tasks (id, title, completed, created_at, user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [task.id, task.title, task.completed, task.createdAt, userId]
  );
}

export async function updateTask(id, completed, userId) {
  const result = await pool.query(
    `UPDATE tasks
     SET completed = $2
     WHERE id = $1 AND user_id = $3
     RETURNING ${columns}`,
    [id, completed, userId]
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
