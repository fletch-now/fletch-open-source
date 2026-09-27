#!/usr/bin/python3 -I
"""Root-only installation/renewal of the apps.example.com wildcard lineage.

Install as /usr/local/bin/fletch-wildcard-cert and invoke after DNS-01 issuance:
  fletch-wildcard-cert /etc/letsencrypt/live/apps.example.com
Certbot deploy hooks pass the same path in RENEWED_LINEAGE.
The certificate must cover both *.apps.example.com and apps.example.com.
"""
import fcntl
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile

BASE = Path('/etc/nginx/apps-certs')
CONFIG = Path('/etc/nginx/sites-available/fletch-apps')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'}


def command(*args: str) -> bytes:
    return subprocess.run(args, env=ENV, check=True, capture_output=True, timeout=30).stdout


def atomic_write(path: Path, content: bytes, mode: int) -> None:
    fd, name = tempfile.mkstemp(prefix='.fletch-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as target:
            os.fchmod(target.fileno(), mode)
            target.write(content)
            target.flush()
            os.fsync(target.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def main() -> None:
    if os.geteuid() != 0:
        raise ValueError('Run as root.')
    lineage = os.environ.get('RENEWED_LINEAGE') or (sys.argv[1] if len(sys.argv) == 2 else '')
    if lineage != '/etc/letsencrypt/live/apps.example.com':
        if os.environ.get('RENEWED_LINEAGE'):
            return
        raise ValueError('Expected the apps.example.com certificate lineage.')
    source = Path(lineage)
    cert = source / 'fullchain.pem'
    key = source / 'privkey.pem'
    command('openssl', 'x509', '-in', str(cert), '-noout', '-checkend', '604800')
    for host in ['apps.example.com', 'wildcard-check.apps.example.com']:
        result = command('openssl', 'x509', '-in', str(cert), '-noout', '-checkhost', host)
        if b'does match certificate' not in result:
            raise ValueError('Certificate does not cover the app hosts.')
    sans = command('openssl', 'x509', '-in', str(cert), '-noout', '-ext', 'subjectAltName')
    if b'DNS:*.apps.example.com' not in sans:
        raise ValueError('Certificate is missing the wildcard SAN.')
    public_cert = command('openssl', 'x509', '-in', str(cert), '-pubkey', '-noout')
    public_key = command('openssl', 'pkey', '-in', str(key), '-pubout')
    if public_cert != public_key:
        raise ValueError('Certificate and private key do not match.')
    # Root validates the chain against the host trust store before switching.
    command('openssl', 'verify', '-untrusted', str(cert), str(cert))
    contents = cert.read_bytes()
    release = BASE / ('wildcard-' + hashlib.sha256(contents).hexdigest()[:24])
    command('install', '-d', '-m', '0750', '-o', 'root', '-g', 'www-data', str(BASE), str(release))
    command('install', '-m', '0640', '-o', 'root', '-g', 'www-data', str(cert), str(release / 'fullchain.pem'))
    command('install', '-m', '0640', '-o', 'root', '-g', 'www-data', str(key), str(release / 'privkey.pem'))
    previous = CONFIG.read_bytes()
    lines = previous.decode().splitlines(keepends=True)
    replacements = 0
    for index, line in enumerate(lines):
        directive = line.strip().split(' ', 1)[0]
        if directive in ['ssl_certificate', 'ssl_certificate_key']:
            file = 'fullchain.pem' if directive == 'ssl_certificate' else 'privkey.pem'
            lines[index] = f'  {directive} {release / file};\n'
            replacements += 1
    if replacements != 2:
        raise ValueError('Expected exactly one certificate pair in the hosted-app config.')
    atomic_write(CONFIG, ''.join(lines).encode(), 0o644)
    try:
        command('nginx', '-t')
        command('systemctl', 'reload', 'nginx')
    except subprocess.SubprocessError:
        atomic_write(CONFIG, previous, 0o644)
        command('nginx', '-t')
        command('systemctl', 'reload', 'nginx')
        raise
    # Publication bypasses per-host ACME only after successful validation/reload.
    marker = BASE / '.wildcard-active-next.pem'
    marker.unlink(missing_ok=True)
    marker.symlink_to(release / 'fullchain.pem')
    os.replace(marker, BASE / 'wildcard-active.pem')
    print('Wildcard certificate installed; new app publication reuses it.')


if __name__ == '__main__':
    try:
        with open("/run/lock/fletch-wildcard-cert.lock", "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        # Never print a private key or captured subprocess output.
        print(f'Wildcard certificate update failed: {type(error).__name__}', file=sys.stderr)
        sys.exit(1)
