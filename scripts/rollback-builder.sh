#!/usr/bin/env bash
# Restore a reviewed compiled release without rewinding customer data.
set -euo pipefail

SNAPSHOT=/var/backups/fletch/releases/builder-baseline-20260909T112806Z
APPLY=0
COMPATIBILITY_REVIEWED=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --snapshot) [ "$#" -ge 2 ] || exit 64; SNAPSHOT=$2; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --compatibility-reviewed) COMPATIBILITY_REVIEWED=1; shift ;;
    --help)
      echo "Usage: $0 [--snapshot DIRECTORY] [--apply --compatibility-reviewed]"
      echo "Default: verify immutable backup artifacts without changing production."
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 64 ;;
  esac
done

SNAPSHOT=$(cd "$SNAPSHOT" && pwd)
APPLICATION_ARCHIVE=application.tar.gz
MANIFEST=SHA256SUMS
if [ ! -f "$SNAPSHOT/$APPLICATION_ARCHIVE" ]; then
  APPLICATION_ARCHIVE=application-runtime.tar.gz
  MANIFEST=PORTABLE-SHA256SUMS
fi
for artifact in "$APPLICATION_ARCHIVE" configuration.tar.gz sandbox-image.tar.gz sandbox-image-id.txt build-id.txt; do
  [ -f "$SNAPSHOT/$artifact" ] || { echo "Missing artifact: $artifact" >&2; exit 1; }
  awk -v artifact="$artifact" '$2 == artifact && $1 ~ /^[[:xdigit:]]+$/ && length($1) == 64 { found = 1 } END { exit !found }' "$SNAPSHOT/$MANIFEST" || {
    echo "Artifact absent from checksum manifest: $artifact" >&2; exit 1;
  }
done
(cd "$SNAPSHOT" && sha256sum --check --status "$MANIFEST")
IMAGE_ID=$(cat "$SNAPSHOT/sandbox-image-id.txt")
[[ "$IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo "Invalid pinned image ID" >&2; exit 1; }
tar -tzf "$SNAPSHOT/$APPLICATION_ARCHIVE" | awk '
  $0 == "application/.next/standalone/server.js" { server = 1 }
  $0 == "application/.next/BUILD_ID" { build = 1 }
  $0 == "application/.next/static/" { assets = 1 }
  $0 == "application/node_modules/" { dependencies = 1 }
  END { exit !(server && build && assets && dependencies) }
'
tar -tzf "$SNAPSHOT/configuration.tar.gz" | awk '
  $0 == "usr/local/bin/fletch-publish-site" { helper = 1 }
  END { exit !helper }
'
echo "Backup checksums, compiled application and pinned image record verified."
if [ "$APPLY" != 1 ]; then
  echo "No changes made. Applying requires --apply --compatibility-reviewed; read docs/operations/servers.md."
  exit 0
fi
[ "$COMPATIBILITY_REVIEWED" = 1 ] || { echo "Review current schema and runtime compatibility before applying." >&2; exit 64; }
[ "$(id -u)" = 0 ] || { echo "Apply must run as root on the production host." >&2; exit 1; }

# Backup verification above remains available; applying old source is fenced.
bash "$(dirname "${BASH_SOURCE[0]}")/legacy-build-deploy-guard.sh"

APP=/opt/fletch/app
ENV_FILE=/etc/fletch/fletch.env
NGINX=/etc/nginx/sites-enabled/fletch
HELPER=/usr/local/bin/fletch-publish-site
exec 9>/run/fletch-builder-rollback.lock
flock -n 9 || { echo "Another builder rollback is running." >&2; exit 1; }
systemctl is-active --quiet fletch
for worker_unit in fletch-build-worker.service fletch-build.service; do
  if systemctl is-active --quiet "$worker_unit" || systemctl is-enabled --quiet "$worker_unit"; then
    echo "Drain or reconcile accepted work, then disable $worker_unit before this release-specific rollback." >&2
    exit 1
  fi
done
[ -f "$ENV_FILE" ] && [ -f "$NGINX" ] && [ -f "$HELPER" ]
ATTEMPT=$(mktemp -d /opt/fletch/rollback-attempt.XXXXXX)
chmod 0700 "$ATTEMPT"
tar -xzf "$SNAPSHOT/$APPLICATION_ARCHIVE" -C "$ATTEMPT"
tar -xzf "$SNAPSHOT/configuration.tar.gz" -C "$ATTEMPT" usr/local/bin/fletch-publish-site
[ "$(cat "$ATTEMPT/application/.next/BUILD_ID")" = "$(cat "$SNAPSHOT/build-id.txt")" ]
bash -n "$ATTEMPT/usr/local/bin/fletch-publish-site"
if ! docker image inspect "$IMAGE_ID" >/dev/null 2>&1; then
  docker load -i "$SNAPSHOT/sandbox-image.tar.gz" >/dev/null
fi
[ "$(docker image inspect --format '{{.Id}}' "$IMAGE_ID")" = "$IMAGE_ID" ]
cp -p "$ENV_FILE" "$ATTEMPT/environment-before"
chmod 0600 "$ATTEMPT/environment-before"
cp -p "$NGINX" "$ATTEMPT/nginx-before"
cp -p "$HELPER" "$ATTEMPT/helper-before"
WATCH_ACTIVE=0
if systemctl is-active --quiet fletch-watch; then WATCH_ACTIVE=1; fi
GATED=0
STOP_STARTED=0
IMAGE_CHANGED=0
HELPER_CHANGED=0
COMMITTED=0

function set_image() {
  python3 - "$ENV_FILE" "$1" "$ATTEMPT/environment-before" <<'PY'
import os
import re
import sys
import tempfile
from pathlib import Path
path = Path(sys.argv[1]).resolve(strict=True)
pattern = re.compile(r'^\s*(?:export\s+)?FORGE_AGENT_IMAGE\s*=')
lines = path.read_text().splitlines(keepends=True)
retained = [line for line in lines if not pattern.match(line)]
if sys.argv[2] == 'restore':
    replacements = [line for line in Path(sys.argv[3]).read_text().splitlines(keepends=True) if pattern.match(line)]
else:
    replacements = ['FORGE_AGENT_IMAGE=' + sys.argv[2] + '\n']
if retained and not retained[-1].endswith('\n'):
    retained[-1] += '\n'
metadata = path.stat()
descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='.fletch-env-rollback-')
try:
    with os.fdopen(descriptor, 'w') as output:
        output.write(''.join(retained + replacements))
        os.fchmod(output.fileno(), metadata.st_mode & 0o777)
        os.fchown(output.fileno(), metadata.st_uid, metadata.st_gid)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY
}

function healthy() {
  systemctl is-active --quiet fletch && curl -fsS --max-time 15 'http://127.0.0.1:3000/api/health?deep=1' >/dev/null
}

function restore_gate() {
  cat "$ATTEMPT/nginx-before" > "$NGINX" || return 1
  nginx -t || return 1
  systemctl reload nginx || return 1
  GATED=0
}

function recover() {
  local result=$?
  trap - EXIT INT TERM
  if [ "$COMMITTED" = 1 ]; then
    if [ "$result" != 0 ]; then echo "Healthy rollback retained; inspect the submission gate. $ATTEMPT" >&2; fi
    exit "$result"
  fi
  if [ "$STOP_STARTED" = 1 ]; then
    # The gate stays closed if any recovery step fails.
    systemctl stop fletch || { echo "Recovery failed; submissions remain gated. $ATTEMPT" >&2; exit 1; }
    if [ "$WATCH_ACTIVE" = 1 ]; then systemctl stop fletch-watch || exit 1; fi
    if [ -d "$ATTEMPT/previous-application" ]; then
      if [ -e "$APP" ]; then mv "$APP" "$ATTEMPT/rejected-application" || exit 1; fi
      mv "$ATTEMPT/previous-application" "$APP" || exit 1
    fi
    if [ "$IMAGE_CHANGED" = 1 ]; then set_image restore || exit 1; fi
    if [ "$HELPER_CHANGED" = 1 ]; then cp -p "$ATTEMPT/helper-before" "$HELPER" || exit 1; fi
    systemctl start fletch || exit 1
    if [ "$WATCH_ACTIVE" = 1 ]; then systemctl start fletch-watch || exit 1; fi
    sleep 5
    healthy || { echo "Recovery health check failed; submissions remain gated. $ATTEMPT" >&2; exit 1; }
    if [ "$WATCH_ACTIVE" = 1 ]; then systemctl is-active --quiet fletch-watch || exit 1; fi
  fi
  if [ "$GATED" = 1 ]; then restore_gate || exit 1; fi
  echo "Rollback not applied; prior runtime retained. Review $ATTEMPT" >&2
  exit "$result"
}
trap recover EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

OLD_NGINX_WORKERS=$(ps -C nginx -o pid=,args= | awk '/nginx: worker process/ {print $1}')
GATED=1
python3 - "$NGINX" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
source = path.read_text()
anchor = '  server_name builder.example.com;'
route = '  location = /api/builds {'
if source.count(anchor) != 1 or 'Builds are briefly paused for an update.' in source:
    raise SystemExit('Cannot safely identify an ungated application server')
block = '''
    default_type application/json;
    if ($request_method = POST) {
      add_header Retry-After 15 always;
      return 503 '{"error":"Builds are briefly paused for an update. Your draft is saved. Try again shortly."}';
    }
'''
if source.count(route) == 1:
    source = source.replace(route, route + block, 1)
elif 'location = /api/builds' in source:
    raise SystemExit('Cannot identify the existing build route safely')
else:
    gate = route + block + '''
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
'''
    source = source.replace(anchor, anchor + '\n' + gate, 1)
path.write_text(source)
PY
nginx -t
systemctl reload nginx
[ "$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' -X POST https://builder.example.com/api/builds)" = 503 ]

function active_count() {
  (cd "$APP" && node - "$ENV_FILE" <<'NODE'
const fs = require('node:fs');
const { Pool } = require('pg');
const env = require('dotenv').parse(fs.readFileSync(process.argv[2]));
if (env.FORGE_MAINNET_DEPLOYS === '1') process.exit(1);
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, query_timeout: 10000 });
(async function count() {
  try {
    const { rows } = await pool.query("select count(*)::integer as count from builds where status in ('queued','provisioning','building','compiling')");
    process.stdout.write(String(rows[0].count));
  } catch { process.exitCode = 1; }
  finally { await pool.end(); }
})();
NODE
  )
}

for attempt in $(seq 1 360); do
  count=$(active_count) || { echo "Cannot drain safely; check database access and disabled mainnet deployment." >&2; exit 1; }
  [[ "$count" =~ ^[0-9]+$ ]] || exit 1
  old_workers=0
  for pid in $OLD_NGINX_WORKERS; do
    if ps -p "$pid" -o args= 2>/dev/null | grep -q 'nginx: worker process'; then old_workers=$((old_workers + 1)); fi
  done
  if [ "$count" = 0 ] && [ "$old_workers" = 0 ]; then break; fi
  echo "Waiting: $count build(s), $old_workers pre-gate proxy worker(s) ($attempt/360)"
  sleep 10
done
[ "$count" = 0 ] && [ "$old_workers" = 0 ] || { echo "Drain timed out; leaving the existing release running." >&2; exit 1; }
[ "$(active_count)" = 0 ]
if docker ps --format '{{.Names}}' | grep -Eq '^fletch-(agent|tool|web)-'; then
  echo "A build container is still active; inspect it before retrying." >&2
  exit 1
fi
if pgrep -f '(^|[[:space:]])/usr/local/bin/fletch-publish-site([[:space:]]|$)' >/dev/null; then
  echo "A publish helper is still active; inspect it before retrying." >&2
  exit 1
fi

STOP_STARTED=1
systemctl stop fletch
if [ "$WATCH_ACTIVE" = 1 ]; then systemctl stop fletch-watch; fi
mv "$APP" "$ATTEMPT/previous-application"
mv "$ATTEMPT/application" "$APP"
IMAGE_CHANGED=1
set_image "$IMAGE_ID"
if ! cmp -s "$HELPER" "$ATTEMPT/usr/local/bin/fletch-publish-site" || [ "$(stat -c '%u:%g:%a' "$HELPER")" != 0:0:755 ]; then
  HELPER_CHANGED=1
  install -o root -g root -m 0755 "$ATTEMPT/usr/local/bin/fletch-publish-site" "$HELPER"
fi
systemctl start fletch
if [ "$WATCH_ACTIVE" = 1 ]; then systemctl start fletch-watch; fi
sleep 5
healthy
if [ "$WATCH_ACTIVE" = 1 ]; then systemctl is-active --quiet fletch-watch; fi
[ "$(cat "$APP/.next/BUILD_ID")" = "$(cat "$SNAPSHOT/build-id.txt")" ]
cmp "$HELPER" "$ATTEMPT/usr/local/bin/fletch-publish-site"
[ "$(stat -c '%u:%g:%a' "$HELPER")" = 0:0:755 ]
# Once reopening begins, new requests may arrive; automatic reversion would
# interrupt them even if nginx reports a reload error.
COMMITTED=1
restore_gate
echo "Builder rollback complete. Previous release and recovery files retained at $ATTEMPT"
echo "Database, project files, admin credentials and provider credentials retained."
