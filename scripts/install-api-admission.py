#!/usr/bin/python3 -I
"""Install reviewed proxy admission rules without restarting the application."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

DESTINATIONS = {
    'nginx-api-limits.conf': Path('/etc/nginx/conf.d/fletch-api-limits.conf'),
    'nginx-api-admission.conf': Path('/etc/nginx/snippets/fletch-api-admission.conf'),
}
CONFIG = Path('/etc/nginx/sites-available/fletch')


def write(path: Path, data: bytes) -> None:
    fd, name = tempfile.mkstemp(prefix='.fletch-admission-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as target:
            os.fchmod(target.fileno(), 0o644)
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def main() -> None:
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise ValueError('Run as root with the reviewed scripts directory.')
    source = Path(sys.argv[1])
    previous = {path: path.read_bytes() if path.exists() else None for path in [CONFIG, *DESTINATIONS.values()]}
    text = previous[CONFIG].decode()
    marker = '  include /etc/nginx/snippets/fletch-api-admission.conf;'
    if marker not in text:
        needle = '  client_max_body_size 2m;'
        if text.count(needle) != 1:
            raise ValueError('Expected one product server body limit.')
        text = text.replace(needle, needle + '\n\n' + marker)
    try:
        for name, path in DESTINATIONS.items():
            write(path, (source / name).read_bytes())
        write(CONFIG, text.encode())
        subprocess.run(['nginx', '-t'], check=True, timeout=15)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        for path, content in previous.items():
            if content is None:
                path.unlink(missing_ok=True)
            else:
                write(path, content)
        subprocess.run(['nginx', '-t'], check=True, timeout=15)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True, timeout=15)
        raise
    print('API admission rules installed. Application and workers were not restarted.')


if __name__ == '__main__':
    main()
