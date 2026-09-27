#!/usr/bin/env python3
"""Pull the latest completed DB/source archives into private off-host storage."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

PATTERN = re.compile(r"^fletch-(?:\d{8}-\d{6}(?:-\d{3})?\.dump|sources-\d{8}-\d{6}-\d{3}\.tar\.gz)$")
INVENTORY = r'''
import json, pathlib, re
root=pathlib.Path('/var/backups/fletch')
patterns=[r'fletch-\d{8}-\d{6}(?:-\d{3})?\.dump',r'fletch-sources-\d{8}-\d{6}-\d{3}\.tar\.gz']
results=[]
for pattern in patterns:
 files=sorted([p for p in root.iterdir() if re.fullmatch(pattern,p.name) and p.is_file() and not p.is_symlink()],reverse=True)
 for path in files:
  receipt=pathlib.Path(str(path)+'.json')
  if not receipt.is_file() or receipt.is_symlink(): continue
  data=json.loads(receipt.read_text())
  if data.get('file') != path.name or data.get('bytes') != path.stat().st_size: raise RuntimeError('receipt mismatch')
  results.append({k:data[k] for k in ['file','bytes','sha256','at']})
  break
print(json.dumps(results))
'''


def digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def pull(args):
    if not re.fullmatch(r'[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+', args.host):
        raise ValueError('invalid host')
    destination = Path(args.destination).expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.stat().st_mode & 0o077:
        raise ValueError('destination must be private (0700)')
    transport = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no', '-o', 'ConnectTimeout=10', '-i', str(Path(args.key).expanduser())]
    result = subprocess.run(['ssh', *transport, args.host, 'python3 -'], input=INVENTORY, text=True,
                            capture_output=True, check=True, timeout=30)
    if len(result.stdout) > 16_384:
        raise ValueError('oversized inventory')
    inventory = json.loads(result.stdout)
    if not isinstance(inventory, list) or len(inventory) > 2:
        raise ValueError('invalid inventory')
    copied = []
    for receipt in inventory:
        name = receipt.get('file', '')
        size = receipt.get('bytes')
        expected = receipt.get('sha256', '')
        if not PATTERN.fullmatch(name) or not isinstance(size, int) or not 0 < size <= 50 * 1024**3 or not re.fullmatch(r'[a-f0-9]{64}', expected):
            raise ValueError('invalid archive receipt')
        target = destination / name
        if target.is_symlink():
            raise ValueError('destination symlink rejected')
        if target.exists():
            if target.stat().st_size != size or digest(target) != expected:
                raise ValueError('existing archive mismatch')
            copied.append({**receipt, 'downloaded': False})
            continue
        if shutil.disk_usage(destination).free < size + 5 * 1024**3:
            raise ValueError('insufficient local disk')
        handle, partial = tempfile.mkstemp(prefix='.pull-', dir=destination)
        os.close(handle)
        try:
            subprocess.run(['scp', *transport, f'{args.host}:/var/backups/fletch/{name}', partial],
                           capture_output=True, check=True, timeout=1800)
            path = Path(partial)
            if path.stat().st_size != size or digest(path) != expected:
                raise ValueError('download verification failed')
            os.chmod(path, 0o600)
            with path.open('rb') as stream:
                os.fsync(stream.fileno())
            os.replace(path, target)
            with (destination / (name + '.json')).open('x') as stream:
                json.dump(receipt, stream)
                stream.write('\n')
                stream.flush()
                os.fsync(stream.fileno())
            copied.append({**receipt, 'downloaded': True})
        finally:
            Path(partial).unlink(missing_ok=True)
    if not any(item['file'].endswith('.dump') for item in copied):
        raise ValueError('no completed database backup')
    return {'event': 'offhost_backup_verified', 'archives': copied,
            'sourceBackupAvailable': any(item['file'].endswith('.tar.gz') for item in copied)}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True)
    parser.add_argument('--key', required=True)
    parser.add_argument('--destination', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(pull(args)))
    except Exception:
        print(json.dumps({'event': 'offhost_backup_failed'}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
