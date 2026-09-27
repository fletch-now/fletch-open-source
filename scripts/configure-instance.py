#!/usr/bin/env python3
"""Render public operations templates for your domains without changing source."""
import argparse
import hashlib
from pathlib import Path
import re
import shutil


def hostname(value):
    if len(value) > 253 or not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', value):
        raise argparse.ArgumentTypeError('Use a lowercase DNS hostname without a scheme, port or path.')
    return value


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--app-domain', required=True, type=hostname)
parser.add_argument('--apps-domain', required=True, type=hostname)
parser.add_argument('--output', default='release-config')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = Path(args.output).resolve()
if output.exists():
    parser.error('Output already exists; use a new directory so reviewed files are preserved.')
output.mkdir(parents=True, mode=0o700)
for source in (root / 'scripts').rglob('*'):
    if not source.is_file() or '__pycache__' in source.parts or source.name.startswith('test') or '.test.' in source.name:
        continue
    target = output / source.relative_to(root)
    target.parent.mkdir(parents=True, exist_ok=True)
    text = source.read_text()
    for old, new in [('apps.example.com', args.apps_domain), ('builder.example.com', args.app_domain)]:
        text = text.replace(old.replace('.', r'\.'), new.replace('.', r'\.')).replace(old, new)
    target.write_text(text)
    shutil.copymode(source, target)
helper = output / 'scripts/fletch-publish-site'
installer = output / 'scripts/install-publish-helper.py'
text = installer.read_text()
text = re.sub(r"EXPECTED_SHA256 = '[a-f0-9]{64}'", "EXPECTED_SHA256 = '" + hashlib.sha256(helper.read_bytes()).hexdigest() + "'", text)
installer.write_text(text)
(output / 'public-domain-values.env.example').write_text(
    f'NEXT_PUBLIC_APP_URL=https://{args.app_domain}\nNEXT_PUBLIC_APP_DOMAIN={args.app_domain}\n'
    f'BETTER_AUTH_URL=https://{args.app_domain}\nNEXT_PUBLIC_APPS_DOMAIN={args.apps_domain}\n')
print(f'Rendered operations templates in {output}. Review DNS, TLS, paths, users and network settings before installing. No server was changed.')
