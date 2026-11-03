import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import * as database from './db.js';
import { createAuth } from './auth.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const publicRoot = resolve(new URL('../dist', import.meta.url).pathname);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function send(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw Object.assign(new Error('Use Content-Type: application/json'), { status: 415 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
    return data;
  } catch { throw Object.assign(new Error('Send a valid JSON object'), { status: 400 }); }
}

export function createApp({ store = database, env = process.env } = {}) {
  const auth = createAuth(env);
  const clients = new Set();
  const attempts = new Map();
  const metadata = { name: 'task-api', version, environment: env.APP_ENV || 'local', revision: env.APP_REVISION || 'local' };
  function broadcast() {
    for (const client of clients) {
      // Slow consumers reconnect and refresh instead of accumulating memory.
      if (!client.write('event: tasks\ndata: {}\n\n')) client.destroy();
    }
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const originalPath = new URL(req.url, 'http://localhost').pathname;
      const path = originalPath.startsWith('/api/') ? originalPath.slice(4) : originalPath;
      if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok', storage: 'postgres', ...metadata });
      if (req.method === 'GET' && path === '/ready') {
        try { await store.pool.query('SELECT 1'); return send(res, 200, { status: 'ready', ...metadata }); }
        catch { return send(res, 503, { status: 'unavailable' }); }
      }
      if (req.method === 'GET' && path === '/version') return send(res, 200, metadata);
      if (!['GET', 'HEAD'].includes(req.method) && !auth.validOrigin(req)) return send(res, 403, { error: 'Invalid request origin' });
      if (req.method === 'GET' && path === '/session') return send(res, 200, { authenticated: auth.loggedIn(req), authDisabled: auth.disabled });
      if (req.method === 'POST' && path === '/login') {
        if (auth.disabled) return send(res, 200, { authenticated: true });
        const now = Date.now();
        for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
        const key = req.socket.remoteAddress;
        const entry = attempts.get(key) || { count: 0, until: now + 60_000 };
        attempts.set(key, entry);
        if (++entry.count > 10) { res.setHeader('Retry-After', '60'); return send(res, 429, { error: 'Too many attempts. Try again in a minute.' }); }
        const body = await readJson(req);
        if (!auth.verifyPassword(body.password)) return send(res, 401, { error: 'Incorrect password' });
        res.setHeader('Set-Cookie', auth.issueCookie());
        return send(res, 200, { authenticated: true });
      }
      if (req.method === 'POST' && path === '/logout') {
        res.setHeader('Set-Cookie', auth.clearCookie());
        return send(res, 200, { authenticated: false });
      }
      const isProtected = ['/tasks', '/events'].includes(path) || path.startsWith('/tasks/');
      if (isProtected && !auth.loggedIn(req)) return send(res, 401, { error: 'Please sign in' });
      if (req.method === 'GET' && path === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('event: connected\ndata: {}\n\n');
        clients.add(res);
        const heartbeat = setInterval(() => {
          if (!auth.loggedIn(req)) return res.end();
          if (!res.write(': heartbeat\n\n')) res.destroy();
        }, 15_000);
        res.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
        return;
      }
      if (req.method === 'GET' && path === '/tasks') return send(res, 200, await store.listTasks());
      if (req.method === 'POST' && path === '/tasks') {
        const body = await readJson(req);
        if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) return send(res, 400, { error: 'Title must contain 1–200 characters' });
        const task = { id: randomUUID(), title: body.title.trim(), completed: false, createdAt: new Date().toISOString() };
        await store.saveTask(task);
        broadcast();
        res.setHeader('Location', `/api/tasks/${task.id}`);
        return send(res, 201, task);
      }
      const match = path.match(/^\/tasks\/([^/]+)$/);
      if (match && ['GET', 'PATCH', 'DELETE'].includes(req.method)) {
        const task = await store.getTask(match[1]);
        if (!task) return send(res, 404, { error: 'Task not found' });
        if (req.method === 'GET') return send(res, 200, task);
        if (req.method === 'DELETE') {
          await store.deleteTask(task.id); broadcast(); res.writeHead(204); return res.end();
        }
        const body = await readJson(req);
        if (typeof body.completed !== 'boolean') return send(res, 400, { error: 'completed must be true or false' });
        const updated = await store.updateTask(task.id, body.completed);
        if (!updated) return send(res, 404, { error: 'Task not found' });
        broadcast(); return send(res, 200, updated);
      }
      if (req.method === 'GET' && (originalPath === '/' || originalPath.startsWith('/assets/'))) {
        const filename = resolve(publicRoot, originalPath === '/' ? 'index.html' : '.' + decodeURIComponent(originalPath));
        if (!filename.startsWith(publicRoot + sep)) return send(res, 404, { error: 'Not found' });
        try {
          const contents = await readFile(filename);
          res.writeHead(200, { 'Content-Type': types[extname(filename)] || 'application/octet-stream', 'Cache-Control': originalPath === '/' ? 'no-cache' : 'public, max-age=31536000, immutable' });
          return res.end(contents);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.headersSent && !res.destroyed) send(res, error.status || 500, { error: error.status ? error.message : 'Internal server error' });
      else res.end();
    }
  });
  server.closeStreams = () => { for (const client of clients) client.end(); };
  return server;
}
