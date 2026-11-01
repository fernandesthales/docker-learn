import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  listTasks,
  getTask,
  saveTask,
  updateTask,
  deleteTask
} from './db.js';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8'
  });

  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const contentType = req.headers['content-type']
    ?.split(';')[0]
    .trim();

  if (contentType !== 'application/json') {
    throw Object.assign(
      new Error('Use Content-Type: application/json'),
      { status: 415 }
    );
  }

  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > 16384) {
      throw Object.assign(
        new Error('Request body too large'),
        { status: 413 }
      );
    }

    chunks.push(chunk);
  }

  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error();
    }

    return body;
  } catch {
    throw Object.assign(
      new Error('Send a valid JSON object'),
      { status: 400 }
    );
  }
}

export function createApp() {
  const environment = process.env.APP_ENV || 'local';

  return createServer(async (req, res) => {
    console.log(`${req.method} ${req.url}`);

    try {
      const path = new URL(req.url, 'http://localhost').pathname;

      if (req.method === 'GET' && path === '/') {
        return send(res, 200, {
          message: `Welcome to Task API v${version}!`,
          version,
          endpoints: [
            'GET /version',
            'GET /health',
            'GET /tasks',
            'GET /tasks/:id',
            'POST /tasks',
            'PATCH /tasks/:id',
            'DELETE /tasks/:id'
          ]
        });
      }

      if (req.method === 'GET' && path === '/health') {
        return send(res, 200, {
          status: 'ok',
          storage: 'postgres',
          version
        });
      }

      if (req.method === 'GET' && path === '/version') {
        return send(res, 200, {
          name: 'task-api',
          version,
          environment
        });
      }

      if (req.method === 'GET' && path === '/tasks') {
        const tasks = await listTasks();

        return send(res, 200, tasks);
      }

      if (req.method === 'POST' && path === '/tasks') {
        const body = await readJson(req);

        if (
          typeof body.title !== 'string' ||
          !body.title.trim() ||
          body.title.trim().length > 200
        ) {
          return send(res, 400, {
            error: 'title must contain 1–200 characters'
          });
        }

        const task = {
          id: randomUUID(),
          title: body.title.trim(),
          completed: false,
          createdAt: new Date().toISOString()
        };

        await saveTask(task);

        res.setHeader('Location', `/tasks/${task.id}`);

        return send(res, 201, task);
      }

      const match = path.match(/^\/tasks\/([^/]+)$/);

      if (match && ['GET', 'PATCH', 'DELETE'].includes(req.method)) {
        const task = await getTask(match[1]);

        if (!task) {
          return send(res, 404, {
            error: 'Task not found'
          });
        }

        if (req.method === 'GET') {
          return send(res, 200, task);
        }

        if (req.method === 'DELETE') {
          await deleteTask(task.id);

          res.writeHead(204);
          return res.end();
        }

        const body = await readJson(req);

        if (typeof body.completed !== 'boolean') {
          return send(res, 400, {
            error: 'completed must be true or false'
          });
        }

        const updatedTask = await updateTask(
          task.id,
          body.completed
        );

        if (!updatedTask) {
          return send(res, 404, {
            error: 'Task not found'
          });
        }

        return send(res, 200, updatedTask);
      }

      return send(res, 404, {
        error: 'Route not found'
      });
    } catch (error) {
      if (!error.status) {
        console.error(error);
      }

      return send(res, error.status || 500, {
        error: error.status
          ? error.message
          : 'Internal server error'
      });
    }
  });
}