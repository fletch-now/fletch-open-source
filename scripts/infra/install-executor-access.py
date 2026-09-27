#!/usr/bin/env python3
"""Authorize only the configured control server to control Docker and read execution resources."""
import argparse
import os
from pathlib import Path
import pwd
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--public-key', required=True)
parser.add_argument('--machine-id', required=True)
args = parser.parse_args()
assert os.geteuid() == 0
assert Path('/etc/machine-id').read_text().strip() == args.machine_id
assert re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/=]+', args.public_key)
try:
    account = pwd.getpwnam('fletch-executor')
except KeyError:
    subprocess.run(['useradd', '--system', '--create-home', '--home-dir', '/var/lib/fletch-executor', '--shell', '/bin/sh', '--groups', 'docker', 'fletch-executor'], check=True)
    account = pwd.getpwnam('fletch-executor')
directory = Path(account.pw_dir) / '.ssh'
directory.mkdir(mode=0o700, exist_ok=True)
os.chown(directory, account.pw_uid, account.pw_gid)
authorized = directory / 'authorized_keys'
text = f'from="10.77.0.1",restrict,command="/usr/local/sbin/fletch-executor-command" {args.public_key}\n'
if authorized.exists() and authorized.read_text() != text:
    raise SystemExit('Existing executor authorization differs; refusing replacement.')
authorized.write_text(text)
authorized.chmod(0o600)
os.chown(authorized, account.pw_uid, account.pw_gid)
Path('/etc/ssh/sshd_config.d/60-fletch-executor.conf').write_text('''Match User fletch-executor
    AuthenticationMethods publickey
    PasswordAuthentication no
    AllowTcpForwarding no
    AllowStreamLocalForwarding no
    PermitTTY no
    X11Forwarding no
    AllowAgentForwarding no
    MaxSessions 128
    ForceCommand /usr/local/sbin/fletch-executor-command
Match all
''')
subprocess.run(['/usr/sbin/sshd', '-t'], check=True)
subprocess.run(['systemctl', 'reload', 'ssh'], check=True)
