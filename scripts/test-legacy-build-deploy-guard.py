#!/usr/bin/env python3
"""Local-only execution fixtures for legacy deployment refusal."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class LegacyGuard(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fletch-deploy-guard-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = self.root / 'configuration'
        self.worker = self.root / 'worker'
        self.unit = self.root / 'worker.service'
        self.old_unit = self.root / 'old-worker.service'
        self.guard = self.root / 'guard.sh'
        source = (ROOT / 'scripts/legacy-build-deploy-guard.sh').read_text()
        replacements = {
            '/opt/fletch/build-worker': str(self.worker),
            '/etc/systemd/system/fletch-build-worker.service': str(self.unit),
            '/etc/systemd/system/fletch-build.service': str(self.old_unit),
            '/opt/fletch/app/package.json': str(ROOT / 'package.json'),
            '/etc/fletch/fletch.env': str(self.env),
        }
        for old, new in replacements.items():
            source = source.replace(old, new)
        self.guard.write_text(source)
        self.env.write_text('FORGE_BUILD_EXECUTION=legacy\n')

    def run_guard(self):
        return subprocess.run(['bash', str(self.guard)], capture_output=True, text=True, timeout=5)

    def test_legacy_configuration_passes_without_writes(self):
        before = self.env.read_bytes()
        result = self.run_guard()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.env.read_bytes(), before)
        self.assertEqual(result.stdout, '')

    def test_worker_routing_refuses_and_configuration_is_literal(self):
        marker = self.root / 'must-not-exist'
        self.env.write_text(f'export FORGE_BUILD_EXECUTION="worker"\nSECRET="$(touch {marker})"\n')
        result = self.run_guard()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('docs/operations/servers.md', result.stderr)
        self.assertNotIn('SECRET', result.stdout + result.stderr)
        self.assertFalse(marker.exists())

    def test_installed_or_broken_link_worker_refuses_even_legacy_configuration(self):
        for path in [self.worker, self.unit, self.old_unit]:
            path.symlink_to(self.root / 'missing-target')
            self.assertNotEqual(self.run_guard().returncode, 0)
            path.unlink()

    def test_missing_or_unknown_configuration_fails_closed(self):
        self.env.unlink()
        self.assertNotEqual(self.run_guard().returncode, 0)
        self.env.write_text('FORGE_BUILD_EXECUTION=unexpected\n')
        self.assertNotEqual(self.run_guard().returncode, 0)

    def test_deploy_refuses_before_any_staging_or_rsync(self):
        binaries = self.root / 'bin'
        binaries.mkdir()
        log = self.root / 'commands'
        ssh = binaries / 'ssh'
        ssh.write_text('#!/bin/sh\ncat > "$GUARD_INPUT"\nprintf "ssh readonly probe\\n" >> "$COMMAND_LOG"\nexit 1\n')
        ssh.chmod(0o755)
        rsync = binaries / 'rsync'
        rsync.write_text('#!/bin/sh\nprintf "rsync MUTATION\\n" >> "$COMMAND_LOG"\nexit 99\n')
        rsync.chmod(0o755)
        payload = self.root / 'probe.sh'
        result = subprocess.run(['bash', str(ROOT / 'scripts/deploy-legacy.sh')], capture_output=True, text=True, timeout=5,
                                env={**os.environ, 'PATH': str(binaries) + ':' + os.environ['PATH'],
                                     'GUARD_INPUT': str(payload), 'COMMAND_LOG': str(log), 'DEPLOY_BUILD_WORKER': '0'})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(log.read_text(), 'ssh readonly probe\n')
        self.assertEqual(payload.read_bytes(), (ROOT / 'scripts/legacy-build-deploy-guard.sh').read_bytes())
        self.assertNotIn('syncing source', result.stdout)

    def test_rollback_keeps_verification_available_but_guards_before_mutations(self):
        source = (ROOT / 'scripts/rollback-builder.sh').read_text()
        guard = source.index('bash "$(dirname "${BASH_SOURCE[0]}")/legacy-build-deploy-guard.sh"')
        self.assertLess(source.index('if [ "$APPLY" != 1 ]'), guard)
        for mutation in ['exec 9>', 'ATTEMPT=$(mktemp', 'tar -xzf', 'docker load', 'systemctl stop']:
            self.assertLess(guard, source.index(mutation))


if __name__ == '__main__':
    unittest.main()
