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

export async function listTasks() {
  const result = await pool.query(`
    SELECT ${columns}
    FROM tasks
    ORDER BY created_at, id
  `);

  return result.rows;
}

export async function getTask(id) {
  const result = await pool.query(
    `SELECT ${columns} FROM tasks WHERE id = $1`,
    [id]
  );

  return result.rows[0];
}

export async function saveTask(task) {
  await pool.query(
    `INSERT INTO tasks (id, title, completed, created_at)
     VALUES ($1, $2, $3, $4)`,
    [task.id, task.title, task.completed, task.createdAt]
  );
}

export async function updateTask(id, completed) {
  const result = await pool.query(
    `UPDATE tasks
     SET completed = $2
     WHERE id = $1
     RETURNING ${columns}`,
    [id, completed]
  );

  return result.rows[0];
}

export async function deleteTask(id) {
  await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
}
