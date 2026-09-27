#!/usr/bin/env python3
"""Run the installed helper shape in disposable, network-disabled containers."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
IMAGE = os.environ.get('FLETCH_TEST_SANDBOX_IMAGE', 'fletch-agent:latest')

FIXTURE = r'''
set -euo pipefail
mkdir -p /fixture-bin /state /run/lock /var/lib/fletch/sites /etc/letsencrypt/live
export PATH="/fixture-bin:$PATH"
cat > /fixture-bin/certbot <<'SH'
#!/bin/bash
set -euo pipefail
host=""; while [ $# -gt 0 ]; do if [ "$1" = -d ]; then shift; host="$1"; fi; shift; done
echo "certbot $host" >> /state/events
if ! mkdir /state/in-certbot 2>/dev/null; then echo overlap >> /state/events; exit 77; fi
trap 'rmdir /state/in-certbot 2>/dev/null || true' EXIT
if [ "${CASE}" = busy ] && [ ! -e /state/busy-once ]; then touch /state/busy-once; echo 'Another instance of Certbot is already running.'; exit 1; fi
if [ "${CASE}" = failure ]; then echo 'ACME rate limit'; exit 9; fi
if [ "${CASE}" = stop ]; then sleep 300 & echo $! > /state/child; wait; fi
sleep 0.2
mkdir -p "/etc/letsencrypt/live/$host"
echo cert > "/etc/letsencrypt/live/$host/fullchain.pem"
echo key > "/etc/letsencrypt/live/$host/privkey.pem"
SH
cat > /usr/local/bin/fletch-apps-cert-hook <<'SH'
#!/bin/bash
set -euo pipefail
echo "hook $1" >> /state/events
install -d -m 0750 -o root -g www-data /etc/nginx/apps-certs "/etc/nginx/apps-certs/$1"
install -m 0640 -o root -g www-data "/etc/letsencrypt/live/$1/fullchain.pem" "/etc/nginx/apps-certs/$1/fullchain.pem"
install -m 0640 -o root -g www-data "/etc/letsencrypt/live/$1/privkey.pem" "/etc/nginx/apps-certs/$1/privkey.pem"
SH
for name in nginx systemctl; do printf '#!/bin/bash\necho "%s $*" >> /state/events\n' "$name" > "/fixture-bin/$name"; done
chmod 755 /fixture-bin/* /usr/local/bin/fletch-apps-cert-hook
for slug in fixture-one fixture-two; do mkdir -p "/var/lib/fletch/sites/$slug/release"; echo app > "/var/lib/fletch/sites/$slug/release/index.html"; ln -s release "/var/lib/fletch/sites/$slug/current"; done
case "$CASE" in
 wildcard)
  mkdir -p /etc/nginx/apps-certs
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj /CN=apps.example.com -addext 'subjectAltName=DNS:*.apps.example.com,DNS:apps.example.com' -keyout /state/wildcard.key -out /etc/nginx/apps-certs/wildcard-active.pem >/dev/null 2>&1
  : > /state/events
  pids=()
  for index in $(seq 1 70); do
    slug="fixture-$index"
    mkdir -p "/var/lib/fletch/sites/$slug/release"
    echo app > "/var/lib/fletch/sites/$slug/release/index.html"
    ln -s release "/var/lib/fletch/sites/$slug/current"
    bash /fixture/helper "$slug" > "/state/$slug.log" 2>&1 & pids+=("$!")
  done
  for pid in "${pids[@]}"; do wait "$pid"; done
  [ "$(grep -l '^ok fixture-' /state/fixture-*.log | wc -l)" = 70 ]
  [ ! -s /state/events ]
  ;;
 concurrent)
  bash /fixture/helper fixture-one & first=$!
  bash /fixture/helper fixture-two & second=$!
  wait "$first"; wait "$second"
  [ "$(grep -c '^certbot ' /state/events)" = 2 ]; ! grep -q overlap /state/events
  ;;
 busy)
  bash /fixture/helper fixture-one
  [ "$(grep -c '^certbot ' /state/events)" = 2 ]; [ "$(grep -c '^hook ' /state/events)" = 1 ]
  ;;
 failure)
  code=0; bash /fixture/helper fixture-one || code=$?
  [ "$code" = 9 ]; [ "$(grep -c '^certbot ' /state/events)" = 1 ]; ! grep -q '^hook ' /state/events
  ;;
 existing|permissions)
  mkdir -p /etc/letsencrypt/live/fixture-one.apps.example.com
  echo cert > /etc/letsencrypt/live/fixture-one.apps.example.com/fullchain.pem
  echo key > /etc/letsencrypt/live/fixture-one.apps.example.com/privkey.pem
  /usr/local/bin/fletch-apps-cert-hook fixture-one.apps.example.com
  if [ "$CASE" = permissions ]; then chmod 600 /etc/nginx/apps-certs/fixture-one.apps.example.com/*; fi
  : > /state/events; bash /fixture/helper fixture-one
  ! grep -q '^certbot ' /state/events
  if [ "$CASE" = existing ]; then [ ! -s /state/events ]; else grep -q '^hook ' /state/events; fi
  runuser -u www-data -- test -r /etc/nginx/apps-certs/fixture-one.apps.example.com/privkey.pem
  ;;
 stop)
  bash /fixture/helper fixture-one & owner=$!
  for i in $(seq 1 100); do [ -e /state/child ] && break; sleep 0.02; done
  [ -e /state/child ]
  bash /fixture/helper fixture-two & waiter=$!
  sleep 0.1; kill -TERM "$waiter"
  code=0; wait "$waiter" || code=$?; [ "$code" = 143 ]
  kill -0 "$owner"; [ "$(grep -c '^certbot ' /state/events)" = 1 ]
  kill -TERM "$owner"; code=0; wait "$owner" || code=$?; [ "$code" = 143 ]
  state="$(ps -o stat= -p "$(cat /state/child)" || true)"
  [[ -z "$state" || "$state" = Z* ]]
  ;;
esac
echo "PASS $CASE"
'''


class PublicationHelper(unittest.TestCase):
    def test_helper_boundaries(self):
        with tempfile.TemporaryDirectory(prefix='fletch-publish-fixture-') as temporary:
            fixture = Path(temporary)
            shutil.copyfile(ROOT / 'scripts/fletch-publish-site', fixture / 'helper')
            (fixture / 'run').write_text(FIXTURE)
            for path in fixture.iterdir():
                path.chmod(0o644)
            for case in ['wildcard', 'concurrent', 'busy', 'failure', 'existing', 'permissions', 'stop']:
                with self.subTest(case=case):
                    result = subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--user', '0',
                                             '--entrypoint', 'bash', '-e', f'CASE={case}',
                                             '-v', f'{fixture}:/fixture:ro', IMAGE, '/fixture/run'],
                                            capture_output=True, text=True, timeout=30)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertIn(f'PASS {case}', result.stdout)


if __name__ == '__main__':
    unittest.main()
