#!/usr/bin/python3 -I
"""Issue or test the apps wildcard with the installed NameSilo DNS hooks."""
import os
import subprocess
import sys


def main() -> None:
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in {'test', 'issue'}:
        raise ValueError('Run as root: fletch-namesilo-cert test|issue')
    subprocess.run(['/usr/local/bin/fletch-namesilo-dns', 'check'], check=True)
    args = [
        '/usr/bin/certbot', 'certonly', '--non-interactive', '--manual', '--preferred-challenges', 'dns',
        '--cert-name', 'apps.example.com', '-d', 'apps.example.com', '-d', '*.apps.example.com',
        '--manual-auth-hook', '/usr/local/bin/fletch-namesilo-dns auth',
        '--manual-cleanup-hook', '/usr/local/bin/fletch-namesilo-dns cleanup',
        '--deploy-hook', '/usr/local/bin/fletch-wildcard-cert',
    ]
    if sys.argv[1] == 'test':
        args.append('--dry-run')
    subprocess.run(args, check=True)
    if sys.argv[1] == 'issue':
        subprocess.run(['/usr/local/bin/fletch-wildcard-cert', '/etc/letsencrypt/live/apps.example.com'], check=True)


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (OSError, subprocess.SubprocessError):
        print('Certificate setup did not complete. The existing certificate remains in use.', file=sys.stderr)
        sys.exit(1)
