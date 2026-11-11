# Hostinger VPS: existing-server deployment runbook

This project is prepared for an EXISTING VPS. Do not reinstall its OS, replace its global proxy configuration, or run blanket Docker pruning commands. Exact panel-specific site configuration still depends on the VPS details and selected domains.

## 1. Inventory before changes

From your existing SSH session, inspect:

```sh
cat /etc/os-release
free -h
df -h
docker version
docker compose version
ss -ltn
```

Identify the existing web server/control panel and sites on ports 80/443. Confirm architecture (`uname -m`); current CI publishes linux/amd64 images. Check that local ports 3101, 3102, 3103 are unused. Three PostgreSQL containers, three API processes, and existing sites need RAM/CPU/disk headroom; choose limits or upgrade after seeing actual capacity.

If Docker is missing, install Engine + Compose for the observed OS using Docker's official instructions. Do not apply a Hostinger OS template to an existing server: that is not an installation-in-place procedure.

## 2. Prepare a deployment account and directory

Use a dedicated SSH account, with access to Docker and write access only to this project's directory where feasible. Docker group membership is effectively root-level host access; use a dedicated CI key, not your everyday personal key. Keep a recovery SSH login working.

The workflows call this fixed path:

```
/opt/taskroom/deploy/release.sh
```

Install the REVIEWED `deploy/` directory from this repository at `/opt/taskroom/deploy/`, owned by the deployment account. Run scripts with executable permissions:

```sh
chmod +x /opt/taskroom/deploy/release.sh /opt/taskroom/deploy/backup.sh
mkdir -p /opt/taskroom/deploy/envs /opt/taskroom/deploy/state
chmod 700 /opt/taskroom/deploy/envs /opt/taskroom/deploy/state
```

Linux `bash`, `flock`, `python3`, Docker, and Compose with `up --wait` are required. Subsequent changes to deploy scripts need explicit installation on the VPS; promoting an image does not update these host files.

## 3. Create three environment files

Copy `deploy/environment.example` into each of:

- `/opt/taskroom/deploy/envs/dev.env`
- `/opt/taskroom/deploy/envs/stage.env`
- `/opt/taskroom/deploy/envs/prod.env`

Run `npm run secrets` on your own computer three times. Each run prints a session secret and a database password. Copy these into the server env file. Users create their own accounts through the registration form. Never commit those generated values or post them in chat.

Configure:

| Environment | APP_PORT (if available) | PUBLIC_ORIGIN (replace with your DNS names) |
| ----------- | ----------------------- | ------------------------------------------- |
| dev         | 3101                    | https://dev.tasks.example.com               |
| stage       | 3102                    | https://stage.tasks.example.com             |
| prod        | 3103                    | https://tasks.example.com                   |

PUBLIC_ORIGIN must exactly match the browser origin: HTTPS, correct hostname, no trailing slash. Use the generated hexadecimal database passwords to avoid connection-string escaping issues. Do not change POSTGRES_PASSWORD after initial database creation without also rotating the actual PostgreSQL role password.

```sh
chmod 600 /opt/taskroom/deploy/envs/*.env
```

The three Compose projects create `taskroom-dev_db-data`, `taskroom-stage_db-data`, and `taskroom-prod_db-data` separately. They do not adopt old exercise data. Migrating old records is a separate dump/restore operation.

## 4. DNS and HTTPS routing

Create DNS A records for the chosen three hostnames pointing to the VPS IPv4. Only add AAAA records if IPv6 is actually configured. Use the existing web server or CloudPanel to add three NEW reverse-proxy sites and issue TLS certificates. Keep existing sites unchanged.

Route each hostname to its local app port: 127.0.0.1:3101 / 3102 / 3103. `deploy/nginx-location.example` shows the required SSE proxy behavior. In CloudPanel, use its Reverse Proxy site workflow and adapt the location through the panel's vhost editor; preserve the generated TLS and global settings. Disable proxy buffering/cache for SSE and allow long-lived connections. Test the web server config before reloading it.

Do not expose PostgreSQL ports. App ports are bound to loopback, with public traffic entering through HTTPS only. Initial proxy requests will return a gateway error until the first deployment starts the app.

## 5. Authenticate the VPS to GHCR

For a private package, create a GitHub personal access token (classic) with read:packages and package access. As the SAME deployment account used by Actions:

```sh
docker login ghcr.io -u fernandesthales
```

Paste the token at the password prompt. Do not put it in a workflow or shell command history. A public package can be pulled without this login. The CI GITHUB_TOKEN publishes; the VPS credential only pulls.

## 6. Configure GitHub

Create GitHub environments named `dev`, `stage`, and `prod`. Restrict their deployment branches to main where supported; optional reviewers on Prod can add a second approval, but the manual promotion trigger is already required.

Set these repository Actions secrets (or set each in all three GitHub environments):

| Secret          | Value                                                                |
| --------------- | -------------------------------------------------------------------- |
| VPS_HOST        | VPS hostname or IPv4                                                 |
| VPS_PORT        | SSH port, usually 22                                                 |
| VPS_USER        | Deployment account name                                              |
| VPS_SSH_KEY     | Dedicated private SSH key, whose public key is authorized on the VPS |
| VPS_KNOWN_HOSTS | Verified known_hosts entry for this server and SSH port              |

Obtain the host fingerprint through a trusted existing SSH/Hostinger console connection and compare before accepting a scanned key. Do not disable host-key checking. For nonstandard ports, known_hosts uses `[host]:port`.

Only AFTER the server files, credentials, DNS, and proxy are configured, set repository Actions variable `DEPLOY_ENABLED` to `true`. Before that, CI still builds/tests/publishes and skips deployment. No additional manual trigger is needed for Dev once enabled: each successful push build on main deploys automatically. Require the Build and test API check before merging PRs.

## 7. First deployment and promotions

Merge the PR only after CI passes. If you enabled deployments after the merge, rerun that main workflow or push a new legitimate change. Confirm Deploy Dev succeeds, open the HTTPS Dev URL, and create an individual account. Create a task and check live updates from a second browser.

From Actions → Promote release → Run workflow → branch main:

- `stage` promotes the currently healthy Dev release.
- `prod` promotes the currently healthy Stage release.

Source selection occurs on the VPS after acquiring the global release lock. The script verifies the running source image matches its last successful deployment record, then uses the exact digest. It never uses a mutable latest tag. It never copies records between databases.

The app migrates the target database transactionally during startup. The first migration only creates the original tasks table if missing. Add subsequent numbered SQL migrations; never edit an applied migration. Readiness must pass before the successful record is updated. Deployments replace a single app container, so a brief interruption is expected.

## 8. Observability and rollback

Server release history lives in `/opt/taskroom/deploy/state/`: current and previous JSON records per environment plus `history.jsonl`. Do not commit this operational state.

Inspect containers by project:

```sh
docker ps --filter label=com.docker.compose.project=taskroom-dev
```

Use the shown app container name with `docker logs --tail 100 CONTAINER_NAME`.

If an update fails readiness, release.sh attempts to restore the previous application image and leaves the successful record unchanged. If the previous image is also incompatible with the database or unhealthy, the script reports operator intervention required. It does not restore database backups automatically. For a deliberate rollback, a runbook-assisted selection of the previous digest is required; manual Stage/Prod promotion always uses the source environment's current release and is not a rollback selector.

## 9. Backups and recovery

Choose a directory owned by the deployment account, outside the repository, with enough space:

```sh
/opt/taskroom/deploy/backup.sh prod /ABSOLUTE/BACKUP/PATH/tasks-prod-YYYY-MM-DD.dump
```

This uses pg_dump's consistent custom-format dump, writes a temporary file, and renames it only on success. Schedule daily backups after first deployment using server cron, and copy encrypted backups to independent off-server storage. Define retention and monitor failures. VPS snapshots are helpful but not a substitute for restore-tested database backups.

Test restoration into a NEW isolated database/container first using pg_restore. Do not run --clean against production as a practice exercise. Document and measure restoration before considering the environment production-ready.

## Still needed for final server setup

Actual OS/version, RAM, current panel/web server, chosen domain/hostnames, and verified SSH access. No server deployment has been performed merely by preparing this repository.
