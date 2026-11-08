#!/bin/bash
# Forced command for the GitHub Actions Dev key. SSH_ORIGINAL_COMMAND is untrusted.
set -euo pipefail
pattern='^/opt/taskroom/deploy/release\.sh dev (ghcr\.io/fernandesthales/docker-learn@sha256:[a-f0-9]{64}) ([a-f0-9]{40}) ([0-9]+)$'
if [[ ${SSH_ORIGINAL_COMMAND:-} =~ $pattern ]]; then
  exec /opt/taskroom/deploy/release.sh dev "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
fi
echo 'Dev release commands only.' >&2
exit 1
