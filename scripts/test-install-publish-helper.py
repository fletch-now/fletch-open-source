#!/usr/bin/env python3
"""Exercise real Linux install, sudo and mount-namespace checks in disposable containers."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
BASE_IMAGE = os.environ.get('FLETCH_TEST_SANDBOX_IMAGE', 'fletch-agent:latest')
IMAGE = 'fletch-publish-install-fixture'

FIXTURE = r'''
set -euo pipefail
mkdir -p /state /etc/sudoers.d
groupadd -g 982 fletch
useradd -u 999 -g 982 -m -s /bin/bash fletch
install -m 0440 /fixture/sudoers /etc/sudoers.d/fletch-publish
sleep 60 & worker=$!
echo "$worker" > /state/worker
echo "$CASE" > /state/case
cat > /usr/bin/systemctl <<'SH'
#!/bin/sh
if [ "$1" = list-units ]; then
  echo 'fletch-build-release-one.service loaded active running worker'
  echo 'fletch-build-release-two.service loaded active running worker'
elif [ "$4" = fletch-build-release-two.service ] && [ "$(cat /state/case)" = second-worker-stopped ]; then
  echo 0
else
  cat /state/worker
fi
SH
cat > /usr/bin/certbot <<'SH'
#!/bin/sh
touch /state/certificate-request
exit 99
SH
chmod 755 /usr/bin/systemctl /usr/bin/certbot
helper=/usr/local/bin/fletch-publish-site
installer=(/usr/bin/python3 -I /fixture/installer)
function fail() {
  if "$@" > /state/check.log 2>&1; then cat /state/check.log; exit 1; fi
}
function fingerprint() { sha256sum "$helper"; stat -c '%i %u %g %a' "$helper"; }
function installed() {
  [ "$(stat -c '%u:%g:%a' "$helper")" = 0:0:755 ]
  cmp /fixture/helper "$helper"
}
case "$CASE" in
 repair)
  install -o 999 -g 982 -m 0600 /fixture/helper "$helper"
  previous_inode="$(stat -c '%i' "$helper")"
  fail "${installer[@]}" check
  "${installer[@]}" install /fixture/helper
  installed
  [ "$(stat -c '%i' "$helper")" != "$previous_inode" ]
  "${installer[@]}" check
  ;;
 hash-mismatch)
  "${installer[@]}" install /fixture/helper
  fingerprint > /state/before
  cp /fixture/helper /state/bad; echo '# unreviewed' >> /state/bad
  fail "${installer[@]}" install /state/bad
  grep -q SHA256 /state/check.log
  fingerprint > /state/after; cmp /state/before /state/after
  echo '# tampered' >> "$helper"
  fail "${installer[@]}" check
  grep -q SHA256 /state/check.log
  ;;
 destination-symlink)
  cp /fixture/helper /state/target; chmod 600 /state/target
  ln -s /state/target "$helper"
  fail "${installer[@]}" install /fixture/helper
  fail "${installer[@]}" check
  [ -L "$helper" ]; [ "$(stat -c '%a' /state/target)" = 600 ]; cmp /fixture/helper /state/target
  ;;
 source-symlink)
  "${installer[@]}" install /fixture/helper
  fingerprint > /state/before
  ln -s /fixture/helper /state/source
  fail "${installer[@]}" install /state/source
  fingerprint > /state/after; cmp /state/before /state/after
  ;;
 parent-symlink)
  mv /usr/local/bin /usr/local/real-bin; ln -s /usr/local/real-bin /usr/local/bin
  fail "${installer[@]}" install /fixture/helper
  grep -q 'never a symlink' /state/check.log
  ;;
 execution-failure)
  "${installer[@]}" install /fixture/helper
  fingerprint > /state/before
  mv /usr/bin/bash /usr/bin/bash-original
  printf '#!/bin/sh\nexit 127\n' > /usr/bin/bash; chmod 755 /usr/bin/bash
  fail "${installer[@]}" check
  grep -q 'expected exit 64' /state/check.log
  fail "${installer[@]}" install /fixture/helper
  fingerprint > /state/after; cmp /state/before /state/after
  ;;
 sudo-denied)
  "${installer[@]}" install /fixture/helper
  rm /etc/sudoers.d/fletch-publish
  fail "${installer[@]}" check
  grep -q 'expected exit 64' /state/check.log
  ;;
 worker-stopped|second-worker-stopped)
  if [ "$CASE" = worker-stopped ]; then echo 0 > /state/worker; fi
  "${installer[@]}" install /fixture/helper
  fail "${installer[@]}" check
  grep -q 'live build worker' /state/check.log
  ;;
 namespace-noexec)
  "${installer[@]}" install /fixture/helper
  unshare --mount bash -c 'mount --bind /usr/local/bin /usr/local/bin; mount -o remount,bind,noexec /usr/local/bin; echo $$ > /state/worker; touch /state/ready; sleep 60' &
  for attempt in $(seq 1 100); do [ -f /state/ready ] && break; sleep 0.02; done
  [ -f /state/ready ]
  code=0; "$helper" > /state/direct.log 2>&1 || code=$?; [ "$code" = 64 ]
  fail "${installer[@]}" check
  grep -q 'expected exit 64' /state/check.log
  ;;
 ownership-mode)
  "${installer[@]}" install /fixture/helper
  chown 999:982 "$helper"
  fail "${installer[@]}" check; grep -q root:root /state/check.log
  chown root:root "$helper"; chmod 0775 "$helper"
  fail "${installer[@]}" check; grep -q 0755 /state/check.log
  chmod 4755 "$helper"
  fail "${installer[@]}" check; grep -q 0755 /state/check.log
  ;;
 non-root)
  fail runuser -u fletch -- "${installer[@]}" install /fixture/helper
  grep -q 'host root' /state/check.log
  fail runuser -u fletch -- "${installer[@]}" check
  grep -q 'host root' /state/check.log
  ;;
 success)
  umask 077
  "${installer[@]}" install /fixture/helper
  installed
  "${installer[@]}" check
  ;;
esac
[ ! -e /state/certificate-request ]
[ -z "$(find /usr/local/bin -maxdepth 1 -name '.fletch-publish-site-*' -print)" ]
echo "PASS $CASE"
'''


class PublicationHelperInstallation(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        dockerfile = f'''FROM {BASE_IMAGE}
USER root
RUN apt-get update -qq && apt-get install -y --no-install-recommends sudo && rm -rf /var/lib/apt/lists/*
'''
        result = subprocess.run(['docker', 'build', '--tag', IMAGE, '-'], input=dockerfile,
                                capture_output=True, text=True, timeout=240)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)

    def test_installation_and_release_boundaries(self) -> None:
        with tempfile.TemporaryDirectory(prefix='fletch-install-fixture-') as temporary:
            fixture = Path(temporary)
            shutil.copyfile(ROOT / 'scripts/fletch-publish-site', fixture / 'helper')
            shutil.copyfile(ROOT / 'scripts/fletch-publish.sudoers', fixture / 'sudoers')
            shutil.copyfile(ROOT / 'scripts/install-publish-helper.py', fixture / 'installer')
            (fixture / 'run').write_text(FIXTURE)
            fixture.chmod(0o755)
            for path in fixture.iterdir():
                path.chmod(0o644)
            cases = ['repair', 'hash-mismatch', 'destination-symlink', 'source-symlink', 'parent-symlink',
                     'execution-failure', 'sudo-denied', 'worker-stopped', 'second-worker-stopped', 'namespace-noexec',
                     'ownership-mode', 'non-root', 'success']
            for case in cases:
                with self.subTest(case=case):
                    result = subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--user', '0',
                                             '--hostname', 'fletch-publish-fixture', '--add-host', 'fletch-publish-fixture:127.0.0.1',
                                             '--cap-add', 'SYS_ADMIN', '--security-opt', 'apparmor=unconfined', '--entrypoint', 'bash', '-e', f'CASE={case}',
                                             '-v', f'{fixture}:/fixture:ro', IMAGE, '/fixture/run'],
                                            capture_output=True, text=True, timeout=30)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertIn(f'PASS {case}', result.stdout)


if __name__ == '__main__':
    unittest.main()
