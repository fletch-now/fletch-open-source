#!/usr/bin/env bash
# Read-only guard for deployment paths written before independent build execution.
set -euo pipefail
refuse() {
  echo "This legacy deployment path cannot preserve independent Build work. Use the reviewed maintenance procedure in docs/operations/servers.md; no changes were made." >&2
  exit 1
}
for path in /opt/fletch/build-worker /etc/systemd/system/fletch-build-worker.service /etc/systemd/system/fletch-build.service; do
  if [ -e "$path" ] || [ -L "$path" ]; then refuse; fi
done
# Parse dotenv literally. No shell evaluation and no configuration values output.
if ! node - <<'NODE'
try {
  const fs = require('node:fs');
  const { createRequire } = require('node:module');
  const load = createRequire('/opt/fletch/app/package.json');
  const configured = load('dotenv').parse(fs.readFileSync('/etc/fletch/fletch.env'));
  const mode = configured.FORGE_BUILD_EXECUTION;
  if (mode !== undefined && mode !== '' && mode !== 'legacy') process.exitCode = 1;
} catch { process.exitCode = 1; }
NODE
then refuse; fi
