#!/usr/bin/python3 -I
"""As host root: /usr/bin/python3 -I scripts/install-publish-helper.py install SOURCE | check.

The reviewed source digest is deliberately pinned here; update it only with a
reviewed helper change. The installed path and execution environment are fixed.
Install validates the host; check also requires safe sudo execution in the live
build worker's mount namespace before maintenance can be cleared.
"""
import argparse
import hashlib
import os
import re
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

DESTINATION = Path('/usr/local/bin/fletch-publish-site')
EXPECTED_SHA256 = '0fc576ac33b5f78be85632f8628bc8d992c478ee70f9ae57562b36756944635b'
VALIDATION_ERROR = 'refused: slug must match ^[a-z0-9][a-z0-9-]{1,60}$\n'
SAFE_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def read_helper(path: Path, installed: bool = False) -> bytes:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as source:
        metadata = os.fstat(source.fileno())
        require(stat.S_ISREG(metadata.st_mode), 'Helper must be a regular file, never a symlink.')
        if installed:
            require(metadata.st_uid == 0 and metadata.st_gid == 0, 'Installed helper must be owned by root:root.')
            require(stat.S_IMODE(metadata.st_mode) == 0o755, 'Installed helper must have mode 0755.')
        content = source.read(1024 * 1024)
    require(hashlib.sha256(content).hexdigest() == EXPECTED_SHA256, 'Helper SHA256 does not match the reviewed source.')
    return content


def check_destination() -> None:
    for directory in reversed(DESTINATION.parents):
        metadata = directory.lstat()
        require(stat.S_ISDIR(metadata.st_mode), f'{directory} must be a directory, never a symlink.')
        require(metadata.st_uid == 0 and metadata.st_gid == 0 and not metadata.st_mode & 0o022,
                f'{directory} must be root:root and not group/other writable.')
    try:
        metadata = DESTINATION.lstat()
    except FileNotFoundError:
        return
    require(stat.S_ISREG(metadata.st_mode), 'Installed destination must be a regular file, never a symlink.')


def check_execution(command: list[str]) -> None:
    # No slug reaches only argument validation, before any certificate or site work.
    result = subprocess.run(command, env=SAFE_ENV, cwd='/', stdin=subprocess.DEVNULL,
                            capture_output=True, text=True, timeout=5)
    require(result.returncode == 64 and result.stdout == '' and result.stderr == VALIDATION_ERROR,
            'Helper did not reach safe no-argument validation (expected exit 64).')


def check_worker() -> None:
    result = subprocess.run([
        '/usr/bin/systemctl', 'list-units', '--type=service', '--state=running',
        '--plain', '--no-legend', 'fletch-build-*.service',
    ], env=SAFE_ENV, capture_output=True, text=True, check=True, timeout=5)
    units = [line.split()[0] for line in result.stdout.splitlines() if line.strip()]
    require(bool(units), 'A live build worker is required before reopening the queue.')
    for unit in units:
        require(re.fullmatch(r'fletch-build-[a-z0-9-]+\.service', unit) is not None,
                'Unexpected build worker unit.')
        result = subprocess.run(['/usr/bin/systemctl', 'show', '--property=MainPID', '--value', unit],
                                env=SAFE_ENV, capture_output=True, text=True, check=True, timeout=5)
        pid = result.stdout.strip()
        require(pid.isdigit() and int(pid) > 1, 'A live build worker is required before reopening the queue.')
        read_helper(Path(f'/proc/{pid}/root{DESTINATION}'), installed=True)
        check_execution(['/usr/bin/nsenter', '--target', pid, '--mount', '--',
                         '/usr/sbin/runuser', '-u', 'fletch', '--', '/usr/bin/sudo', '-n', str(DESTINATION)])


def install(source: Path) -> None:
    content = read_helper(source)
    descriptor, name = tempfile.mkstemp(prefix='.fletch-publish-site-', dir=DESTINATION.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as target:
            target.write(content)
            target.flush()
            os.fchown(target.fileno(), 0, 0)
            os.fchmod(target.fileno(), 0o755)
            os.fsync(target.fileno())
        check_execution([str(temporary)])
        os.replace(temporary, DESTINATION)
        directory = os.open(DESTINATION.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('check')
    commands.add_parser('install').add_argument('source', type=Path)
    arguments = parser.parse_args()
    require(sys.platform == 'linux' and os.geteuid() == 0, 'Run as host root on Linux.')
    check_destination()
    if arguments.command == 'install':
        install(arguments.source)
    read_helper(DESTINATION, installed=True)
    check_execution([str(DESTINATION)])
    if arguments.command == 'check':
        check_worker()
    print(f'ok: {DESTINATION} root:root 0755 SHA256 {EXPECTED_SHA256}; no-argument exit 64; {arguments.command}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f'Publication helper check failed: {error}', file=sys.stderr)
        sys.exit(1)
