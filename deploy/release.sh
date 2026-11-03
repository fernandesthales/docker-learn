#!/usr/bin/env bash
# Installed at /opt/taskroom/deploy/release.sh. Only invoke from a trusted SSH account.
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")"
mkdir -p state envs
# One server-wide lock makes source snapshots and target updates consistent.
exec 9>state/deploy.lock
flock -w 600 9
mode=${1:-}
image=${2:-}
revision=${3:-}
sequence=${4:-}
case "$mode" in
  dev) target=dev ;;
  stage) target=stage; source=dev ;;
  prod) target=prod; source=stage ;;
  *) echo 'Usage: release.sh dev IMAGE_DIGEST COMMIT RUN_NUMBER | stage | prod' >&2; exit 2 ;;
esac
read_record() {
  python3 - "$1" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
print(r['image']); print(r['revision']); print(r['sequence'])
PY
}
if [[ "$target" != dev ]]; then
  [[ -f "state/$source.json" ]] || { echo "No healthy release recorded for $source" >&2; exit 1; }
  mapfile -t record < <(read_record "state/$source.json")
  image=${record[0]}; revision=${record[1]}; sequence=${record[2]}
  # Locate by Compose labels: no dependence on current shell image variables.
  source_id=$(docker ps -q --filter "label=com.docker.compose.project=taskroom-$source" --filter label=com.docker.compose.service=app)
  [[ -n "$source_id" && "$source_id" != *$'\n'* ]] || { echo 'Source app is not running' >&2; exit 1; }
  [[ $(docker inspect -f '{{.State.Health.Status}}' "$source_id") == healthy ]] || { echo 'Source app is not healthy' >&2; exit 1; }
  [[ $(docker inspect -f '{{.Config.Image}}' "$source_id") == "$image" ]] || { echo 'Source container does not match release record' >&2; exit 1; }
fi
[[ "$image" =~ ^ghcr\.io/fernandesthales/docker-learn@sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid image digest' >&2; exit 2; }
[[ "$revision" =~ ^[a-f0-9]{40}$ && "$sequence" =~ ^[0-9]+$ ]] || { echo 'Invalid release metadata' >&2; exit 2; }
[[ -f "envs/$target.env" ]] || { echo "Configure deploy/envs/$target.env first" >&2; exit 1; }
if [[ "$target" == dev && -f state/dev.json ]]; then
  old_sequence=$(python3 -c 'import json; print(json.load(open("state/dev.json"))["sequence"])')
  if (( sequence < old_sequence )); then echo 'Skipping older Dev build; a newer one is already deployed'; exit 0; fi
fi
export ENVIRONMENT=$target IMAGE_REFERENCE=$image RELEASE_REVISION=$revision
compose=(docker compose -p "taskroom-$target" --env-file "envs/$target.env" -f compose.yaml)
printf 'Deploying %s to %s\n' "$image" "$target"
"${compose[@]}" pull app
# --wait checks application DB readiness and authentication configuration at startup.
if ! ( "${compose[@]}" up -d --wait --wait-timeout 180 app &&
  "${compose[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" ); then
  echo 'Deployment failed readiness; release record was not advanced' >&2
  "${compose[@]}" logs --tail 80 app >&2 || true
  if [[ -f "state/$target.json" ]]; then
    mapfile -t previous < <(read_record "state/$target.json")
    export IMAGE_REFERENCE=${previous[0]} RELEASE_REVISION=${previous[1]}
    echo 'Restoring previous application image (database is not rolled back)' >&2
    "${compose[@]}" up -d --wait --wait-timeout 180 app || echo 'Rollback failed: operator intervention required' >&2
  else
    "${compose[@]}" stop app || true
  fi
  exit 1
fi
python3 - "$target" "$image" "$revision" "$sequence" <<'PY'
import json,sys,os,datetime,shutil
target,image,revision,sequence=sys.argv[1:]
path=f'state/{target}.json'
if os.path.exists(path): shutil.copy2(path,f'state/{target}.previous.json')
record=dict(image=image,revision=revision,sequence=int(sequence),deployed_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
with open(path+'.tmp','w') as f: json.dump(record,f,indent=2)
os.replace(path+'.tmp',path)
with open('state/history.jsonl','a') as f: f.write(json.dumps(dict(environment=target,**record))+'\n')
print(json.dumps(dict(environment=target,**record),indent=2))
PY
