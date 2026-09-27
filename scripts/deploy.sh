#!/usr/bin/env bash
# Switch a separately built immutable release. The operator preserves live workers.
set -euo pipefail

RELEASE_ID=""
RELEASE_ROOT=""
RELEASE_PORT=""
for arg in "$@"; do
  case "$arg" in
    --id=*) RELEASE_ID="${arg#*=}" ;;
    --root=*) RELEASE_ROOT="${arg#*=}" ;;
    --port=*) RELEASE_PORT="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done
if ! [[ "$RELEASE_ID" =~ ^[a-z0-9][a-z0-9-]{5,63}$ && "$RELEASE_ROOT" =~ ^/opt/fletch/[a-zA-Z0-9/_-]+$ && "$RELEASE_ROOT" != *..* && "$RELEASE_PORT" =~ ^30[0-9][0-9]$ && "$RELEASE_PORT" != 3000 ]]; then
  echo "Usage: bash scripts/deploy.sh --id=RELEASE --root=/opt/fletch/web-releases/RELEASE --port=3001" >&2
  echo "Build the immutable candidate first. See scripts/rolling/README.md." >&2
  exit 1
fi
if [[ "${DEPLOY_BUILD_WORKER:-0}" != 0 || -n "${DEPLOY_AGENT_IMAGE:-}" || -n "${DEPLOY_PROXY_BIND:-}" ]]; then
  echo "Use the worker-generation workflow for worker, image or proxy changes. See scripts/rolling/README.md." >&2
  exit 1
fi

HOST="${FLETCH_HOST:?Set FLETCH_HOST to your deployment SSH destination}"
SSH_OPTIONS=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
if [[ -n "${FLETCH_KEY:-}" ]]; then SSH_OPTIONS+=(-i "$FLETCH_KEY"); fi
printf -v REMOTE_COMMAND '%q ' /usr/bin/node "$RELEASE_ROOT/scripts/rolling/web-deploy.mjs" "--id=$RELEASE_ID" "--root=$RELEASE_ROOT" "--port=$RELEASE_PORT" --apply=yes
ssh "${SSH_OPTIONS[@]}" "$HOST" "$REMOTE_COMMAND"
