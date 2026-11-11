import { createApp } from './app.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be 1–65535');
// Validate auth configuration before connecting to the database.
const server = createApp();
try {
  await migrate(pool);
} catch (error) {
  console.error('Migration failed', error);
  await pool.end();
  process.exit(1);
}
server.listen(port, '0.0.0.0', () =>
  console.log(
    `Task Board listening on ${port} (${process.env.APP_ENV || 'local'})`
  )
);
server.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    server.closeStreams();
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
