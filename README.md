# Task API — your first Docker learning project

A small Node.js API with no external dependencies. This is the starting application for your Docker exercise: run it locally first, then containerize it yourself. A Dockerfile is included. PostgreSQL is not included yet.

## Run in VS Code

1. Install Node.js 22 or newer if needed. Check with `node --version`.
2. Extract the ZIP. Open the extracted `task-api` folder in VS Code (the folder containing `package.json`).
3. Open Terminal → New Terminal and run:

```sh
npm run dev
```

No `npm install` is required: everything uses Node's built-in modules.

4. Visit http://localhost:3000/health in your browser. Expect `{"status":"ok","storage":"memory","version":"1.1.0"}`.
5. Keep the terminal running. Use a second terminal for the requests below. Stop the server with Ctrl+C.

`npm run dev` restarts the server when you edit code. `npm start` runs it without watching files. Both lose all tasks when the process restarts.

## Try the API

These curl examples work in macOS/Linux terminals. You can also use Postman with the same methods, URLs and JSON bodies. On Windows PowerShell, use Postman or the included requests file to avoid shell quoting differences.

Create a task:

```sh
curl -i -X POST http://localhost:3000/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Learn Docker"}'
```

The response includes a generated `id`. Copy it and replace `YOUR_TASK_ID` in the commands below.

List tasks:

```sh
curl http://localhost:3000/tasks
```

Complete a task:

```sh
curl -X PATCH http://localhost:3000/tasks/YOUR_TASK_ID \
  -H 'Content-Type: application/json' \
  -d '{"completed":true}'
```

Delete a task (success is HTTP 204 with no response body):

```sh
curl -i -X DELETE http://localhost:3000/tasks/YOUR_TASK_ID
```

`requests.http` contains the same requests for use with a compatible VS Code HTTP client extension. Set its `taskId` variable manually after creating a task.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | / | Show API information |
| GET | /health | Check that the process is responding |
| GET | /tasks | List all tasks |
| GET | /tasks/:id | Get one task |
| POST | /tasks | Create using `{ "title": "Learn Docker" }` |
| PATCH | /tasks/:id | Update using `{ "completed": true }` |
| DELETE | /tasks/:id | Delete one task |

Titles must have 1–200 characters after trimming. JSON writes require `Content-Type: application/json`. Missing tasks return 404; invalid input returns 400.

## Understand the files

- `src/app.js`: HTTP routes, JSON validation, and in-memory task storage.
- `src/server.js`: port configuration, listening, and shutdown.
- `test/api.test.js`: an HTTP test of the task lifecycle and validation.
- `package.json`: commands you run with npm.
- `.dockerignore`: files to exclude from your future Docker build context.

Run the tests with `npm test`. They start their own server on a free port.

## Your next Docker exercises

1. Read the included Dockerfile: it starts from a Node image, sets a working directory, copies the code, and runs `npm start`.
2. Build your image and start a container with host port 3000 mapped to container port 3000.
3. Repeat these API requests and inspect the container logs.
4. Stop and replace the container. Observe that in-memory tasks disappear.
5. Add PostgreSQL as a separate Compose service, change the API to store tasks there, and attach a named volume to the database service.

This API binds to `0.0.0.0` so it can receive forwarded requests in a container. `PORT` defaults to `3000`. On macOS/Linux you can run `PORT=3001 npm start` if 3000 is occupied; in PowerShell use `$env:PORT=3001` before running `npm start`.

This is a local learning app without authentication or persistent storage. No frontend is included.

## Rebuild exercise: version 1.1.0

This release changes the welcome message, adds version to /health, and adds GET /version.

1. Extract this ZIP into a separate folder and open its task-api directory in VS Code, or replace the matching files in your existing project.
2. From the folder containing the updated Dockerfile, build a distinctly tagged image:

```sh
docker buildx build --load -t task-api:1.1.0 .
```

If your previous container uses copied source, it still serves the old code after this build. If you previously used a bind mount and overwrite that mounted source, changes may appear immediately instead. The run command below uses no bind mount so you can practice image-based updates.

3. Replace the old container (stopping it clears its in-memory tasks):

```sh
docker stop task-api-container
docker rm task-api-container
docker run --name task-api-container -p 3000:3000 -d task-api:1.1.0
```

If the old container no longer exists, skip the stop/remove commands.

4. Open http://localhost:3000/version or run:

```sh
curl http://localhost:3000/version
```

Expected response:

```json
{"name":"task-api","version":"1.1.0"}
```

The image tag is a label; the version response comes from package.json copied into the image. Building alone does not replace a running container.
