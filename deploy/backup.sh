#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")"
environment=${1:-}
[[ "$environment" =~ ^(dev|stage|prod)$ ]] || { echo 'Usage: backup.sh dev|stage|prod OUTPUT.dump' >&2; exit 2; }
output=${2:?Choose an absolute backup output path}
[[ "$output" == /* && ! -e "$output" ]] || { echo 'Use a new absolute output path' >&2; exit 2; }
container=$(docker ps -q --filter "label=com.docker.compose.project=taskroom-$environment" --filter label=com.docker.compose.service=db)
[[ -n "$container" && "$container" != *$'\n'* ]] || { echo 'Database is not running' >&2; exit 1; }
trap 'rm -f -- "$output.partial"' EXIT
docker exec "$container" pg_dump -U app -d tasks -Fc > "$output.partial"
mv -- "$output.partial" "$output"
echo "Backup written to $output; copy it off this VPS."
