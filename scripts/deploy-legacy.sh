#!/usr/bin/env bash
# Deploy Fletch to production.
#
# The environment lives at /etc/fletch/fletch.env, OUTSIDE the synced directory:
# this script rsyncs with --delete, and an env file inside /opt/fletch/app would be
# removed on the first deploy.
set -euo pipefail

HOST="${FLETCH_HOST:?Set FLETCH_HOST to your deployment SSH destination}"
KEY="${FLETCH_KEY:-$HOME/.ssh/fletch_deploy_ed25519}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3"
DEPLOY_BUILD_WORKER="${DEPLOY_BUILD_WORKER:-0}"
if ! [[ "$DEPLOY_BUILD_WORKER" =~ ^[01]$ ]]; then
  echo "DEPLOY_BUILD_WORKER must be 0 or 1"
  exit 1
fi

# The live server reads .next while it runs, so building in place breaks every
# route for the length of the build. Source is synced to a staging tree, built
# there, and swapped in with a rename; the old tree is kept for one deploy.
STAGE=/opt/fletch/stage
APP=/opt/fletch/app

# Refuse incompatible execution before staging, rsync or any remote mutation.
$SSH "$HOST" "bash -s" < "$(dirname "${BASH_SOURCE[0]}")/legacy-build-deploy-guard.sh"

echo "→ syncing source to staging"
$SSH "$HOST" "mkdir -p $STAGE && if [ ! -d $STAGE/node_modules ] && [ -d $APP/node_modules ]; then cp -al $APP/node_modules $STAGE/node_modules; fi"
rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude '.next' \
  --exclude '.env' --exclude '.env.*' \
  --exclude 'tsconfig.tsbuildinfo' \
  -e "$SSH" ./ "$HOST:$STAGE/"

echo "→ building in staging, then swapping"
if [ -n "${DEPLOY_AGENT_IMAGE:-}" ] && ! [[ "$DEPLOY_AGENT_IMAGE" =~ ^[a-zA-Z0-9._:/-]+$ ]]; then
  echo "invalid sandbox image reference"
  exit 1
fi
if [ -n "${DEPLOY_PROXY_BIND:-}" ] && ! [[ "$DEPLOY_PROXY_BIND" =~ ^[0-9.]+$ ]]; then
  echo "invalid Docker bridge address"
  exit 1
fi
$SSH "$HOST" "DEPLOY_REGISTRY=${DEPLOY_REGISTRY:-0} DEPLOY_BUILD_WORKER=$DEPLOY_BUILD_WORKER DEPLOY_AGENT_IMAGE=${DEPLOY_AGENT_IMAGE:-} DEPLOY_PROXY_BIND=${DEPLOY_PROXY_BIND:-} bash -s" <<'REMOTE'
set -euo pipefail
STAGE=/opt/fletch/stage
APP=/opt/fletch/app
WORKER=/opt/fletch/build-worker
WORKER_UNIT=/etc/systemd/system/fletch-build-worker.service
chown -R fletch:fletch "$STAGE"
cd "$STAGE"
sudo -u fletch npm ci --no-audit --no-fund --silent
# NEXT_PUBLIC_* are inlined at build time and cannot be changed at runtime. The
# Reown project id is read from the box's own env file: passing it from the
# operator's shell can mismatch the configured wallet project.
env_value() {
  node - "$1" <<'NODEENV'
const fs = require('node:fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('/etc/fletch/fletch.env'));
process.stdout.write(env[process.argv[2]] ?? '');
NODEENV
}
REOWN_ID=$(env_value NEXT_PUBLIC_REOWN_PROJECT_ID)
DB_URL=$(env_value DATABASE_URL)
sudo -u fletch env \
  DATABASE_URL="${DB_URL:-}" \
  NEXT_PUBLIC_APP_URL=https://builder.example.com \
  NEXT_PUBLIC_APP_DOMAIN=builder.example.com \
  NEXT_PUBLIC_APPS_DOMAIN=apps.example.com \
  NEXT_PUBLIC_REOWN_PROJECT_ID="${REOWN_ID:-}" \
  npx next build
sudo -u fletch cp -r .next/static .next/standalone/.next/static
sudo -u fletch cp -r public .next/standalone/public 2>/dev/null || true
# Gate new build submissions while existing builds drain. A count of zero alone
# races the next submission and can interrupt a just-started customer build.
NGINX=/etc/nginx/sites-enabled/fletch
NGINX_BACKUP=$(mktemp /run/fletch-nginx-deploy.XXXXXX)
cp "$NGINX" "$NGINX_BACKUP"
ENV_BACKUP=""
SWAP_STARTED=0
RELEASE_COMMITTED=0
WORKER_STOPPED=0
WORKER_SWAP_STARTED=0
WORKER_STAGE=""
restore_agent_environment() {
  if [ -n "$ENV_BACKUP" ]; then
    cat "$ENV_BACKUP" > /etc/fletch/fletch.env || return 1
    rm -f "$ENV_BACKUP" || return 1
    ENV_BACKUP=""
  fi
}
restore_build_worker() {
  if [ -n "$WORKER_STAGE" ]; then rm -rf "$WORKER_STAGE" || return 1; fi
  if [ "$WORKER_STOPPED" != "1" ]; then return 0; fi
  echo "restoring previous build worker source and unit"
  systemctl stop fletch-build-worker || return 1
  if [ "$WORKER_SWAP_STARTED" = "1" ] && [ -d "$WORKER-prev" ]; then
    if [ -e "$WORKER" ]; then mv "$WORKER" "$WORKER-failed-$(date +%s)" || return 1; fi
    cp -al "$WORKER-prev" "$WORKER" || return 1
  fi
  cp -p "$WORKER-prev.service" "$WORKER_UNIT" || return 1
  systemctl daemon-reload || return 1
  systemctl start fletch-build-worker || return 1
  sleep 2
  systemctl is-active fletch-build-worker || return 1
}
rollback_release() {
  if [ "$RELEASE_COMMITTED" = "1" ]; then return 0; fi
  restore_agent_environment || return 1
  restore_build_worker || return 1
  if [ "$SWAP_STARTED" = "1" ] && [ "$RELEASE_COMMITTED" != "1" ] && [ -d "$APP-prev" ]; then
    echo "restoring previous application source and sandbox configuration"
    if [ -e "$APP" ]; then mv "$APP" "$APP-failed-$(date +%s)" || return 1; fi
    cp -al "$APP-prev" "$APP" || return 1
    systemctl restart fletch || return 1
    sleep 5
    systemctl is-active fletch || return 1
    curl -fsS --max-time 15 http://127.0.0.1:3000/api/health || return 1
  fi
}
restore_build_submissions() {
  if ! rollback_release; then
    echo "rollback failed; build submissions remain gated for recovery"
    return 1
  fi
  cat "$NGINX_BACKUP" > "$NGINX"
  nginx -t || return 1
  systemctl reload nginx || return 1
  rm -f "$NGINX_BACKUP" || return 1
}
finish_deploy() {
  local status=$?
  trap - EXIT
  if ! restore_build_submissions; then exit 1; fi
  exit "$status"
}
trap finish_deploy EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# A request buffered by an old Nginx worker can reach the app after reload.
# Legacy execution also needs those proxy workers drained; verified independent
# execution can reconnect its subscribers after a web-only restart.
OLD_NGINX_WORKERS=$(ps -C nginx -o pid=,args= | awk '/nginx: worker process/ {print $1}')
python3 - <<'PY'
from pathlib import Path
path = Path('/etc/nginx/sites-enabled/fletch')
source = path.read_text()
anchor = '  server_name builder.example.com;'
if source.count(anchor) != 1:
    raise SystemExit('Cannot identify the application server for the build submission gate')
block = """
    default_type application/json;
    if ($request_method = POST) {
      add_header Retry-After 15 always;
      return 503 '{"error":"Builds are briefly paused for an update. Your draft is saved. Try again shortly."}';
    }
"""
route = '  location = /api/builds {'
if source.count(route) == 1:
    # Keep the endpoint's body limit and proxy configuration during the drain.
    source = source.replace(route, route + block, 1)
elif 'location = /api/builds' in source:
    raise SystemExit('Cannot identify the existing build route safely')
else:
    gate = route + block + """
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
"""
    source = source.replace(anchor, anchor + '\n' + gate, 1)
path.write_text(source)
PY
nginx -t
systemctl reload nginx
# Legacy builds execute in the web process and must drain. An unchanged,
# independently owned worker can continue while its web subscribers reconnect.
# Keep the conservative drain whenever the process and database checks disagree.
DRAINED=0
for i in $(seq 1 360); do
  old_workers=0
  for pid in $OLD_NGINX_WORKERS; do
    if ps -p "$pid" -o args= 2>/dev/null | grep -q 'nginx: worker process'; then old_workers=$((old_workers + 1)); fi
  done
  if ! drain=$(DATABASE_URL="$DB_URL" node - <<'NODECOUNT'
const { Pool } = require('pg');
const configured = require('dotenv').parse(require('node:fs').readFileSync('/etc/fletch/fletch.env'));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, query_timeout: 10000 });
(async function count() {
  try {
    const { readDeployDrain } = await import('./scripts/deploy-build-drain.mjs');
    const result = await readDeployDrain(pool, {
      worker: process.env.DEPLOY_BUILD_WORKER ?? '0', registry: process.env.DEPLOY_REGISTRY ?? '0',
      image: process.env.DEPLOY_AGENT_IMAGE ?? '', proxyBind: process.env.DEPLOY_PROXY_BIND ?? '',
    }, configured.FORGE_BUILD_EXECUTION);
    process.stdout.write(`${result.count} ${result.mode}`);
  } catch {
    process.exitCode = 1;
  } finally { await pool.end(); }
})();
NODECOUNT
  ); then
    echo "could not read active builds; leaving the live app running"
    exit 1
  fi
  if ! [[ "$drain" =~ ^[0-9]+[[:space:]](full|worker-web)$ ]]; then
    echo "invalid active-build count; leaving the live app running"
    exit 1
  fi
  read -r n drain_mode <<< "$drain"
  if [ "$n" = "0" ] && { [ "$drain_mode" = "worker-web" ] || [ "$old_workers" = "0" ]; }; then
    DRAINED=1
    if [ "$drain_mode" = "worker-web" ]; then echo "  independent build worker retained; web streams will reconnect"; fi
    break
  fi
  echo "  waiting: $n build(s), $old_workers pre-gate proxy worker(s) ($i/360)"
  sleep 10
done
if [ "$DRAINED" != "1" ]; then
  echo "a build is still running after an hour; not restarting"
  exit 1
fi
# The image is prepared separately. Activate it only after submissions are gated
# and active builds drain; restore the previous environment on any failed rollout.
if [ -n "${DEPLOY_AGENT_IMAGE:-}" ] || [ -n "${DEPLOY_PROXY_BIND:-}" ]; then
  if [ -n "${DEPLOY_AGENT_IMAGE:-}" ]; then docker image inspect "$DEPLOY_AGENT_IMAGE" >/dev/null; fi
  ENV_BACKUP=$(mktemp /run/fletch-env-deploy.XXXXXX)
  cp /etc/fletch/fletch.env "$ENV_BACKUP"
  export DEPLOY_AGENT_IMAGE DEPLOY_PROXY_BIND
  python3 - <<'PYENV'
import ipaddress
import json
import os
import subprocess
from pathlib import Path
updates = {}
if os.environ.get('DEPLOY_AGENT_IMAGE'):
    updates['FORGE_AGENT_IMAGE'] = os.environ['DEPLOY_AGENT_IMAGE']
if os.environ.get('DEPLOY_PROXY_BIND'):
    address = ipaddress.ip_address(os.environ['DEPLOY_PROXY_BIND'])
    network = json.loads(subprocess.check_output(['docker', 'network', 'inspect', 'bridge'], text=True))[0]
    gateways = {entry.get('Gateway') for entry in network['IPAM']['Config']}
    if address.version != 4 or not address.is_private or str(address) not in gateways:
        raise SystemExit('The model proxy must bind to the actual private Docker bridge gateway')
    updates['FORGE_PROXY_BIND'] = str(address)
path = Path('/etc/fletch/fletch.env')
lines = [line for line in path.read_text().splitlines() if line.partition('=')[0] not in updates]
lines.extend(key + '=' + value for key, value in updates.items())
path.write_text('\n'.join(lines) + '\n')
PYENV
fi
# Worker updates share the same submission gate and drain as the web release.
# The retained unit travels with its source; the shared environment and project
# data remain outside both release trees.
if [ "${DEPLOY_BUILD_WORKER:-0}" = "1" ]; then
  test -d "$WORKER"
  test -f "$WORKER_UNIT"
  systemd-analyze verify "$STAGE/scripts/fletch-build-worker.service"
  WORKER_STAGE=$(mktemp -d /opt/fletch/build-worker-deploy.XXXXXX)
  cp -al "$STAGE/." "$WORKER_STAGE/"
  cp -p "$WORKER_UNIT" "$WORKER-prev.service"
  WORKER_STOPPED=1
  systemctl stop fletch-build-worker
  if systemctl is-active --quiet fletch-build-worker; then
    echo "build worker did not stop; refusing to change its source"
    exit 1
  fi
  rm -rf "$WORKER-prev"
  WORKER_SWAP_STARTED=1
  mv "$WORKER" "$WORKER-prev"
  mv "$WORKER_STAGE" "$WORKER"
  WORKER_STAGE=""
  install -m 0644 "$WORKER/scripts/fletch-build-worker.service" "$WORKER_UNIT"
  systemctl daemon-reload
  systemctl start fletch-build-worker
  sleep 2
  systemctl is-active fletch-build-worker
fi
# Swap: the running process keeps its open files, so the live tree can move out
# from under it; the new tree is a hardlinked copy of staging, which stays put for
# the next incremental sync.
rm -rf "$APP-prev"
SWAP_STARTED=1
mv "$APP" "$APP-prev"
cp -al "$STAGE" "$APP"
chown -R fletch:fletch "$APP"
APP_STARTED=1
systemctl restart fletch || APP_STARTED=0
sleep 5
if [ "$APP_STARTED" != "1" ] || ! systemctl is-active fletch || ! curl -fsS --max-time 15 http://127.0.0.1:3000/api/health; then
  echo "new app failed its health check; EXIT will restore source and environment"
  exit 1
fi
if [ "${DEPLOY_BUILD_WORKER:-0}" = "1" ]; then systemctl is-active fletch-build-worker; fi
RELEASE_COMMITTED=1
# The healthy app now owns this image configuration.
if [ -n "$ENV_BACKUP" ]; then rm -f "$ENV_BACKUP"; ENV_BACKUP=""; fi
# The web app is ready; a slow daemon shutdown need not hold new builds.
restore_build_submissions
trap - EXIT
# fletch-watch is a separate, optional unit (docs/operations/servers.md) — restart it too when
# installed, so a deploy picks up daemon changes without a second manual step, but
# skip it silently on hosts that haven't installed Watch yet.
if systemctl list-unit-files fletch-watch.service >/dev/null 2>&1; then
  systemctl restart fletch-watch
  sleep 2
  systemctl is-active fletch-watch
fi

# fletch-registry runs the authority pipelines (docs/operations/servers.md). A restart
# ends every scan in flight, and a genesis backfill loses its run each time,
# so it restarts only when the deploy says so: DEPLOY_REGISTRY=1.
if [ "${DEPLOY_REGISTRY:-0}" = "1" ] && systemctl list-unit-files fletch-registry.service >/dev/null 2>&1; then
  systemctl restart fletch-registry
  sleep 2
  systemctl is-active fletch-registry
fi
REMOTE
echo
echo "→ live check"
curl -s -o /dev/null -w "https://builder.example.com => %{http_code}\n" --max-time 25 https://builder.example.com/
