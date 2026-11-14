# Taskroom — a live task board and deployment learning project

React + Vite frontend, Node.js HTTP API, PostgreSQL, Server-Sent Events, and a single deployable application image. Three VPS environments promote the same image digest; database records stay separate.

## Run locally

Requires Docker Desktop / Docker Engine with Compose v2.

```sh
docker compose -p taskroom-local -f compose.local.yaml up --build -d
```

Open http://localhost:3010 in two browser windows. Add a task, check it off, or delete it; the second window updates automatically. Create an account with your name, email, and password. Each account sees only its own tasks; the port is bound only to localhost. This uses a new `taskroom-local` volume, not the original exercise's Dev volume.

```sh
docker compose -p taskroom-local -f compose.local.yaml down
```

The named volume keeps your records. Adding `-v` deletes them.

## Development and files

| File                             | Purpose                                                      |
| -------------------------------- | ------------------------------------------------------------ |
| `web/src/main.jsx`               | Board, login, filters, SSE client                            |
| `web/src/style.css`              | Responsive UI                                                |
| `src/app.js`                     | HTTP API, session routes, event stream, static frontend      |
| `src/auth.js`                    | Per-user password hashing and signed HttpOnly session cookie |
| `src/db.js`                      | PostgreSQL connection pool and task queries                  |
| `src/migrate.js`, `migrations/`  | Transactional, tracked schema migrations                     |
| `Dockerfile`                     | Builds frontend, then packages backend and compiled assets   |
| `compose.local.yaml`             | Local app and persistent database                            |
| `compose.test.yaml`              | Isolated API tests and disposable PostgreSQL                 |
| `compose.browser-test.yaml`      | Image-based browser tests with login enabled                 |
| `deploy/`                        | VPS configuration, promotions, backups                       |
| `.github/workflows/ci.yaml`      | Build/test/publish and optional automatic Dev deployment     |
| `.github/workflows/promote.yaml` | Manual Stage or Prod promotion                               |

The original `compose.yaml` is retained for the old tutorial. Use `compose.local.yaml` for this application; do not mix the two project names or replace old volumes.

### Live frontend development

With Node.js 22.12+ (or Node.js 24) and Docker installed, run:

```sh
npm ci
docker compose -p taskroom-local -f compose.local.yaml up --build -d --wait
npm run dev:web
```

Open http://127.0.0.1:5173. Vite serves the frontend directly from `web/`, updates the browser when you save changes, and proxies `/api` to the Docker app on port 3010. Use port 5173 while editing; port 3010 serves the frontend built into the Docker image. Backend changes still require rebuilding the app container with the Compose command above.

If you run the backend directly on port 3000 instead, use `API_PROXY_TARGET=http://127.0.0.1:3000 npm run dev:web`.

### Formatting

Prettier formats source and configuration files with `npm run format`. Run `npm run format:check` to check formatting without changing files. Generated output and local environment files are excluded through `.prettierignore` and `.gitignore`.

The complete Docker route above needs no local Node installation.

## Local checks

```sh
npm ci
npm run build
node --test test/auth.test.js test/deploy.test.js
docker build -t task-api:2.0.0 .
docker compose -p taskroom-api-tests -f compose.test.yaml up --force-recreate --abort-on-container-exit --exit-code-from tests
docker compose -p taskroom-api-tests -f compose.test.yaml down --volumes
```

For real browser tests (macOS/Linux shell):

```sh
npx playwright install chromium
docker compose -p taskroom-browser-tests -f compose.browser-test.yaml up -d --wait
npm run test:e2e
docker compose -p taskroom-browser-tests -f compose.browser-test.yaml down --volumes
```

API tests verify persistence across an API process replacement against real PostgreSQL. Browser tests exercise login and synchronize changes between two independent sessions. Deployment-script tests use a fake Docker command to verify promotion selection, failed-release rollback, and stale Dev build rejection; they do not claim to deploy a real server.

## Deployment behavior

- PR: build one application image, run API/auth and browser tests, publish nothing.
- Push to `main`: build/test/publish that exact image to GHCR. If `DEPLOY_ENABLED=true`, deploy it to Dev by digest.
- Manual **Promote release → stage**: copy the currently healthy Dev image digest into Stage.
- Manual **Promote release → prod**: copy the currently healthy Stage image digest into Prod.
- Promotions snapshot the source when the server obtains its deployment lock, not when the button is clicked. Later source updates do not change that selected release.
- Separate Compose projects and environment files create three databases, networks, and volumes. Every environment uses the same application artifact with runtime configuration.
- A server-wide lock serializes deployments and promotions. Older CI run numbers cannot replace a newer Dev deployment. GitHub may coalesce queued Dev deployments; the newest successful build should win, not every intermediate build.

**Hosting is not activated by this PR.** Follow [the Hostinger runbook](docs/hostinger.md), configure secrets, then enable deployments. No existing VPS sites or proxy configuration are modified automatically.

## API

The frontend uses `/api/tasks`, `/api/session`, `/api/login`, `/api/register`, `/api/logout`, `/api/events`, `/api/version`, and `/api/ready`. Original `/tasks`, `/health`, `/ready`, and `/version` paths remain available. Hosted task routes require a session cookie and mutation requests require the configured Origin. `/` now serves the frontend.

`/health` is liveness; `/ready` queries PostgreSQL and returns 503 on connection failure. `/version` includes app version, environment, and Git revision. SSE sends invalidation notifications; clients refetch the database state on connect, reconnect, and task changes.

## Deliberate first-release boundaries

Individual accounts use email/password login with open self-registration. Email verification, password reset, and profile editing are not implemented. Sessions expire in 12 hours; logout clears the current browser cookie, while rotating SESSION_SECRET invalidates all sessions. Tasks and live notifications are scoped to the signed-in user. Login throttling is in-process and, behind a reverse proxy, may apply collectively to users; add proxy-level rate limiting for larger use.

One API instance per environment. SSE notifications are process-local; multiple replicas would need PostgreSQL LISTEN/NOTIFY or Redis pub/sub. Deployments briefly interrupt requests, and EventSource reconnects. No zero-downtime claim.

Three environments share the VPS and therefore share its capacity and outage risk. Persistence is not backup. Back up production off-server and test restoration. Application rollback never reverses schema migrations; keep schema changes backward-compatible with the previous app release.

## User model and private tasks

`migrations/002_users.sql` creates the `users` table: `id` (primary key), `name` (1–100 characters), unique normalized `email`, salted scrypt `password_hash`, optional integer `age` (0–150), `created_at`, and `updated_at`. Age is the value provided at registration, not an automatically calculated age. Passwords must be 5–256 characters; hashes are never returned by the API.

`tasks.user_id` references `users.id`. Every task read, update, deletion, and live notification is scoped to the authenticated user. `POST /api/register` accepts `{name, email, password, age?}`; `POST /api/login` accepts `{email, password}`. Both set a signed HttpOnly session cookie and return a public user profile. `GET /api/session` returns that profile for the current account.

On upgrade, old shared tasks stay in the database with `user_id = NULL` and are hidden from all accounts. An administrator can assign them to a verified owner explicitly; they are never automatically claimed by the first registrant. Old shared-password sessions are invalid. `AUTH_DISABLED` is no longer supported and `AUTH_PASSWORD_HASH` is no longer needed. Back up before upgrading; rolling back to the old shared-board app would expose account tasks and is not supported after this migration.

For local development, the Compose configuration permits the localhost origins on ports 3010 and 5173. Hosted environments must keep `PUBLIC_ORIGIN` restricted to their actual HTTPS origin and use a unique `SESSION_SECRET`. To upgrade locally, rebuild with `docker compose -p taskroom-local -f compose.local.yaml up --build -d --wait`, then open Vite on port 5173 and create an account.

## Task details

Tasks support an optional **due date**, **priority** (`low`, `medium`, or `high`; defaults to `medium`), and optional **description** (up to 2,000 characters). Expand **Add task details** when creating a task, or choose **Edit details** on an existing task. Saving details synchronizes across browsers signed into the same account.

`POST /api/tasks` accepts `{title, dueDate?, priority?, description?}`. `PATCH /api/tasks/:id` accepts any nonempty subset of `title`, `completed`, `dueDate`, `priority`, and `description`; omitted fields remain unchanged. Send `dueDate: null` or `description: ""` to clear them. Due dates must be real calendar dates in `YYYY-MM-DD` format (years 0001–9999), with no time or timezone. Past dates are allowed. All returned tasks include the three new fields.

Migration `003_task_details.sql` preserves existing tasks with no due date, medium priority, and an empty description. Existing clients that only create titles or change completion continue to work. Task ownership checks apply to every new field.
