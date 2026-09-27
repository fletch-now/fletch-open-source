#!/usr/bin/python3 -I
"""Certbot hooks restricted to _acme-challenge.apps.example.com TXT records."""
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener

KEY = Path('/etc/fletch/namesilo-api.key')
ZONE = 'builder.example.com'
HOST = '_acme-challenge.apps.example.com'
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'}


class DNSFailure(Exception):
    """Only messages written here are safe to log."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise DNSFailure('The DNS API redirected the request. No credential was forwarded.')


def read_key() -> str:
    try:
        fd = os.open(KEY, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        raise DNSFailure('Install the root-only credential at /etc/fletch/namesilo-api.key.') from None
    with os.fdopen(fd) as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
            raise DNSFailure('The DNS credential must be a regular root-owned file with mode 0600.')
        key = source.read(257).strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{16,200}', key):
        raise DNSFailure('The DNS credential format is invalid.')
    return key


def api(key: str, operation: str, **params: str) -> dict:
    if operation not in {'dnsListRecords', 'dnsAddRecord', 'dnsDeleteRecord'}:
        raise DNSFailure('Unsupported DNS operation.')
    query = urlencode({'version': '1', 'type': 'json', 'key': key, 'domain': ZONE, **params})
    # NameSilo requires its batch endpoint for automated requests. Keep the URL
    # out of argv and errors, disable environment proxies and refuse redirects.
    url = f'https://www.namesilo.com/apibatch/{operation}?{query}'
    try:
        with build_opener(ProxyHandler({}), NoRedirect()).open(url, timeout=25) as response:
            payload = response.read(1_048_577)
        if len(payload) > 1_048_576:
            raise DNSFailure('The DNS API response exceeded its size limit.')
        reply = json.loads(payload)['reply']
        if not isinstance(reply, dict) or str(reply.get('code')) != '300':
            raise DNSFailure('The DNS API rejected the request. Check the key and allowed server IP.')
        return reply
    except DNSFailure:
        raise
    except Exception:
        raise DNSFailure('The DNS API request failed or its response format changed.') from None


def records(key: str) -> list[dict]:
    result = api(key, 'dnsListRecords').get('resource_record', [])
    if isinstance(result, dict):
        result = [result]
    if not isinstance(result, list) or any(
        not isinstance(record, dict) or any(
            not isinstance(record.get(field), str) for field in ['record_id', 'type', 'host', 'value']
        ) for record in result
    ):
        raise DNSFailure('The DNS record schema changed.')
    return result


def challenge() -> str:
    if os.environ.get('CERTBOT_DOMAIN') not in {'apps.example.com', '*.apps.example.com'}:
        raise DNSFailure('This hook only validates apps.example.com and its wildcard.')
    value = os.environ.get('CERTBOT_VALIDATION', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{43}', value):
        raise DNSFailure('Invalid ACME challenge value.')
    return value


def matching(record: dict, value: str) -> bool:
    return record['type'] == 'TXT' and record['host'].rstrip('.').lower() == HOST and record['value'] == value


def delete_owned(key: str, record_id: str, value: str) -> None:
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', record_id):
        raise DNSFailure('Invalid DNS cleanup record identity.')
    for record in records(key):
        if record['record_id'] == record_id:
            if not matching(record, value):
                raise DNSFailure('The cleanup record changed. It was retained for operator review.')
            api(key, 'dnsDeleteRecord', rrid=record_id)
            return


def dig(server: str, name: str, kind: str) -> list[str]:
    try:
        result = subprocess.run(
            ['/usr/bin/dig', '@' + server, name, kind, '+short', '+time=2', '+tries=1'],
            env=ENV, check=True, capture_output=True, text=True, timeout=5,
        )
        return result.stdout.strip().splitlines()
    except subprocess.SubprocessError:
        return []


def wait_for_dns(value: str) -> None:
    servers = [server.rstrip('.') for server in dig('1.1.1.1', ZONE, 'NS')]
    if not servers or any(not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.-]{1,252}', server) for server in servers):
        raise DNSFailure('Could not determine the authoritative DNS servers.')
    deadline = time.monotonic() + 1200
    while time.monotonic() < deadline:
        visible = [f'"{value}"' in dig(server, HOST, 'TXT') for server in [*servers, '1.1.1.1', '8.8.8.8']]
        if all(visible):
            return
        print('Waiting for the certificate TXT record to reach all DNS servers.', file=sys.stderr)
        time.sleep(15)
    raise DNSFailure('The certificate TXT record did not propagate within 20 minutes.')


def authenticate(key: str, value: str) -> None:
    current = records(key)
    if any(record['type'] == 'CNAME' and record['host'].rstrip('.').lower() == HOST for record in current):
        raise DNSFailure('The validation name is delegated by CNAME. Review DNS before using this hook.')
    # Preserve a matching pre-existing record. Only this invocation's new ID is
    # passed to cleanup, so concurrent apex and wildcard challenges stay intact.
    record_id = ''
    if not any(matching(record, value) for record in current):
        reply = api(key, 'dnsAddRecord', rrtype='TXT', rrhost='_acme-challenge.apps', rrvalue=value, rrttl='3600')
        record_id = reply.get('record_id', '')
        if not isinstance(record_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', record_id):
            raise DNSFailure('The DNS API did not return a record identity. Inspect validation TXT records.')
    try:
        wait_for_dns(value)
    except Exception:
        if record_id:
            delete_owned(key, record_id, value)
        raise
    print(record_id)


def main() -> None:
    if os.geteuid() != 0:
        raise DNSFailure('Run this certificate hook as root.')
    mode = sys.argv[1] if len(sys.argv) == 2 else ''
    if mode not in {'check', 'auth', 'cleanup'}:
        raise DNSFailure('Usage: fletch-namesilo-dns check|auth|cleanup')
    value = challenge() if mode != 'check' else ''
    key = read_key()
    if mode == 'check':
        print(f'DNS API access verified for {ZONE}; {len(records(key))} records read. No records changed.')
    elif mode == 'auth':
        authenticate(key, value)
    else:
        record_id = os.environ.get('CERTBOT_AUTH_OUTPUT', '').strip()
        if record_id:
            delete_owned(key, record_id, value)


if __name__ == '__main__':
    try:
        main()
    except DNSFailure as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Certificate DNS hook failed. Review the hook configuration.', file=sys.stderr)
        sys.exit(1)
