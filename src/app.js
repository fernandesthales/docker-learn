import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import * as database from './db.js';
import { validateTask } from './task.js';
import { createAuth, hashPassword, verifyPassword } from './auth.js';
import { publicUser, normalizeEmail, validateRegistration } from './user.js';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
// Docker serves Vite's compiled frontend from dist; the development Vite server is separate.
const publicRoot = resolve(new URL('../dist', import.meta.url).pathname);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
// Keep JSON responses consistent and prevent caching of account/task data.
function send(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}
// Node exposes the request body as a stream. Collect up to 16 KiB, then parse one object.
// Errors carry an HTTP status that the request handler below turns into a JSON response.
async function readJson(req) {
  if (
    req.headers['content-type']?.split(';')[0].trim() !== 'application/json'
  ) {
    throw Object.assign(new Error('Use Content-Type: application/json'), {
      status: 415
    });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384)
      throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (!data || Array.isArray(data) || typeof data !== 'object')
      throw new Error();
    return data;
  } catch {
    throw Object.assign(new Error('Send a valid JSON object'), { status: 400 });
  }
}

// Accept dependencies so tests can supply a store or environment configuration.
// This creates the server; server.js handles migrations, listening, and shutdown.
export function createApp({ store = database, env = process.env } = {}) {
  const auth = createAuth(env);
  // These collections belong to this server process, not PostgreSQL or other replicas.
  const clients = new Set(); // Open SSE responses, each associated with a user ID.
  const attempts = new Map(); // Login/registration attempt windows keyed by client IP.
  const metadata = {
    name: 'task-api',
    version,
    environment: env.APP_ENV || 'local',
    revision: env.APP_REVISION || 'local'
  };
  // Send only a change notification, and only to this user's connected browsers.
  // Browsers fetch the latest task data through the authenticated API.
  function broadcast(userId) {
    for (const client of clients) {
      // Slow consumers reconnect and refresh instead of accumulating memory.
      if (
        client.userId === userId &&
        !client.write('event: tasks\ndata: {}\n\n')
      )
        client.destroy();
    }
  }
  // Each request walks these route checks in order. Returning ends that route's handling.
  const server = createServer(async (req, res) => {
    // Browser security headers restrict content loading, embedding, and MIME sniffing.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    );
    try {
      // Support both frontend /api/tasks URLs and the original tutorial's /tasks URLs.
      const originalPath = new URL(req.url, 'http://localhost').pathname;
      const path = originalPath.startsWith('/api/')
        ? originalPath.slice(4)
        : originalPath;
      // Public probes: health checks the process; ready also checks the database connection.
      if (req.method === 'GET' && path === '/health')
        return send(res, 200, {
          status: 'ok',
          storage: 'postgres',
          ...metadata
        });
      if (req.method === 'GET' && path === '/ready') {
        try {
          await store.pool.query('SELECT 1');
          return send(res, 200, { status: 'ready', ...metadata });
        } catch {
          return send(res, 503, { status: 'unavailable' });
        }
      }
      if (req.method === 'GET' && path === '/version')
        return send(res, 200, metadata);
      // Check the browser origin before any write, including login, to reduce CSRF risk.
      if (!['GET', 'HEAD'].includes(req.method) && !auth.validOrigin(req))
        return send(res, 403, { error: 'Invalid request origin' });
      // Verify the signed cookie and confirm the referenced account still exists.
      // Identity comes from the session, never from an ID supplied in the request body.
      const userId = auth.userId(req);
      const user = userId ? await store.getUser(userId) : null;
      if (req.method === 'GET' && path === '/session')
        return send(res, 200, {
          authenticated: !!user,
          user: user ? publicUser(user) : null
        });
      if (req.method === 'POST' && ['/login', '/register'].includes(path)) {
        // Share a 10-attempt/minute limit across login and registration for each socket IP.
        // Behind a reverse proxy, clients may share this IP and therefore this limit.
        const now = Date.now();
        for (const [key, value] of attempts)
          if (value.until < now) attempts.delete(key);
        const key = req.socket.remoteAddress;
        const entry = attempts.get(key) || { count: 0, until: now + 60_000 };
        attempts.set(key, entry);
        if (++entry.count > 10) {
          res.setHeader('Retry-After', '60');
          return send(res, 429, {
            error: 'Too many attempts. Try again in a minute.'
          });
        }
        const body = await readJson(req);
        let account;
        if (path === '/register') {
          // Validate before hashing; persist only the hash, never the plaintext password.
          const profile = validateRegistration(body);
          try {
            account = await store.createUser({
              ...profile,
              id: randomUUID(),
              passwordHash: await hashPassword(body.password)
            });
          } catch (error) {
            // PostgreSQL's unique constraint also handles simultaneous duplicate sign-ups.
            if (error.code === '23505')
              return send(res, 409, {
                error: 'An account with this email already exists'
              });
            throw error;
          }
        } else {
          account = await store.findUserByEmail(normalizeEmail(body.email));
          // Perform the same expensive derivation for unknown emails.
          const valid = await verifyPassword(
            body.password,
            account?.passwordHash ||
              '00000000000000000000000000000000:' + '0'.repeat(64)
          );
          if (!account || !valid)
            return send(res, 401, { error: 'Incorrect email or password' });
        }
        // Both successful routes sign the user in. publicUser excludes the password hash.
        res.setHeader('Set-Cookie', auth.issueCookie(account.id));
        return send(res, path === '/register' ? 201 : 200, {
          authenticated: true,
          user: publicUser(account)
        });
      }
      if (req.method === 'POST' && path === '/logout') {
        res.setHeader('Set-Cookie', auth.clearCookie());
        return send(res, 200, { authenticated: false });
      }
      // Task routes and the live stream require an account; the login page remains public.
      const isProtected =
        ['/tasks', '/events'].includes(path) || path.startsWith('/tasks/');
      if (isProtected && !user)
        return send(res, 401, { error: 'Please sign in' });
      // SSE deliberately leaves the response open so future mutations can write events.
      if (req.method === 'GET' && path === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        res.write('event: connected\ndata: {}\n\n');
        res.userId = user.id;
        clients.add(res);
        // SSE comments keep the connection active; periodically recheck cookie expiration.
        const heartbeat = setInterval(() => {
          if (!auth.userId(req)) return res.end();
          if (!res.write(': heartbeat\n\n')) res.destroy();
        }, 15_000);
        // Release the timer and response reference when the browser disconnects.
        res.on('close', () => {
          clearInterval(heartbeat);
          clients.delete(res);
        });
        return;
      }
      // Pass the authenticated owner into every query, including listing and creation.
      if (req.method === 'GET' && path === '/tasks')
        return send(res, 200, await store.listTasks(user.id));
      if (req.method === 'POST' && path === '/tasks') {
        const body = await readJson(req);
        const fields = validateTask(body);
        const task = {
          id: randomUUID(),
          ...fields,
          completed: false,
          createdAt: new Date().toISOString()
        };
        // Notify browsers only after PostgreSQL has successfully stored the task.
        await store.saveTask(task, user.id);
        broadcast(user.id);
        res.setHeader('Location', `/api/tasks/${task.id}`);
        return send(res, 201, task);
      }
      // Capture a task ID from /tasks/:id. The lookup checks both ID and ownership.
      // A missing task and another user's task both return 404.
      const match = path.match(/^\/tasks\/([^/]+)$/);
      if (match && ['GET', 'PATCH', 'DELETE'].includes(req.method)) {
        const task = await store.getTask(match[1], user.id);
        if (!task) return send(res, 404, { error: 'Task not found' });
        if (req.method === 'GET') return send(res, 200, task);
        if (req.method === 'DELETE') {
          await store.deleteTask(task.id, user.id);
          broadcast(user.id);
          res.writeHead(204);
          return res.end();
        }
        const body = await readJson(req);
        const changes = validateTask(body, { partial: true });
        const updated = await store.updateTask(task.id, changes, user.id);
        if (!updated) return send(res, 404, { error: 'Task not found' });
        broadcast(user.id);
        return send(res, 200, updated);
      }
      // Serve the built frontend after the API routes, allowing the login page without a session.
      if (
        req.method === 'GET' &&
        (originalPath === '/' || originalPath.startsWith('/assets/'))
      ) {
        const filename = resolve(
          publicRoot,
          originalPath === '/'
            ? 'index.html'
            : '.' + decodeURIComponent(originalPath)
        );
        // Keep resolved paths inside dist, rejecting attempts to traverse to other files.
        if (!filename.startsWith(publicRoot + sep))
          return send(res, 404, { error: 'Not found' });
        try {
          const contents = await readFile(filename);
          res.writeHead(200, {
            'Content-Type':
              types[extname(filename)] || 'application/octet-stream',
            'Cache-Control':
              originalPath === '/'
                ? 'no-cache'
                : 'public, max-age=31536000, immutable'
          });
          return res.end(contents);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      // Expose validation messages, but log unexpected failures and hide their details.
      // Once headers are sent (for example for SSE), only close the response.
      if (!error.status) console.error(error);
      if (!res.headersSent && !res.destroyed)
        send(res, error.status || 500, {
          error: error.status ? error.message : 'Internal server error'
        });
      else res.end();
    }
  });
  // Open SSE connections would otherwise keep graceful server shutdown waiting.
  server.closeStreams = () => {
    for (const client of clients) client.end();
  };
  return server;
}
