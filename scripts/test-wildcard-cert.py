#!/usr/bin/env python3
"""Validate wildcard activation and renewal against a local fixture CA."""
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
mkdir -p /state /etc/nginx/sites-available /etc/letsencrypt/live/apps.example.com /run/lock
cat > /usr/sbin/nginx <<'SH'
#!/bin/bash
[ ! -e /state/refuse-nginx ]
SH
cat > /usr/sbin/systemctl <<'SH'
#!/bin/bash
echo reload >> /state/reloads
SH
chmod 755 /usr/sbin/nginx /usr/sbin/systemctl
printf 'server {\n ssl_certificate /old/cert.pem;\n ssl_certificate_key /old/key.pem;\n}\n' > /etc/nginx/sites-available/fletch-apps
function certificate() {
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj /CN=apps.example.com -addext 'subjectAltName=DNS:*.apps.example.com,DNS:apps.example.com' -keyout /etc/letsencrypt/live/apps.example.com/privkey.pem -out /etc/letsencrypt/live/apps.example.com/fullchain.pem >/dev/null 2>&1
  cp /etc/letsencrypt/live/apps.example.com/fullchain.pem "/usr/local/share/ca-certificates/fixture-$1.crt"
  update-ca-certificates >/dev/null 2>&1
}
certificate one
python3 -I /fixture/helper /etc/letsencrypt/live/apps.example.com
first="$(readlink /etc/nginx/apps-certs/wildcard-active.pem)"
[ -f "$first" ]; grep -q "$first" /etc/nginx/sites-available/fletch-apps
certificate two
RENEWED_LINEAGE=/etc/letsencrypt/live/apps.example.com python3 -I /fixture/helper
second="$(readlink /etc/nginx/apps-certs/wildcard-active.pem)"
[ "$first" != "$second" ]; [ -f "$first" ]; [ -f "$second" ]
[ "$(wc -l < /state/reloads)" = 2 ]
cp /etc/nginx/sites-available/fletch-apps /state/prior
certificate three
touch /state/refuse-nginx
if python3 -I /fixture/helper /etc/letsencrypt/live/apps.example.com; then exit 1; fi
cmp /state/prior /etc/nginx/sites-available/fletch-apps
[ "$(readlink /etc/nginx/apps-certs/wildcard-active.pem)" = "$second" ]
rm /state/refuse-nginx
openssl genrsa -out /etc/letsencrypt/live/apps.example.com/privkey.pem 2048 >/dev/null 2>&1
if python3 -I /fixture/helper /etc/letsencrypt/live/apps.example.com; then exit 1; fi
cmp /state/prior /etc/nginx/sites-available/fletch-apps
RENEWED_LINEAGE=/etc/letsencrypt/live/unrelated.example python3 -I /fixture/helper
[ "$(wc -l < /state/reloads)" = 2 ]
echo PASS
'''


class WildcardCertificate(unittest.TestCase):
    def test_activation_renewal_and_rollback(self):
        with tempfile.TemporaryDirectory(prefix='fletch-wildcard-fixture-') as directory:
            fixture = Path(directory)
            shutil.copyfile(ROOT / 'scripts/fletch-wildcard-cert.py', fixture / 'helper')
            (fixture / 'run').write_text(FIXTURE)
            result = subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--user', '0',
                                     '--entrypoint', 'bash', '-v', f'{fixture}:/fixture:ro', IMAGE, '/fixture/run'],
                                    capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('PASS', result.stdout)


if __name__ == '__main__':
    unittest.main()
