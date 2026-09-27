#!/usr/bin/env python3
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backup_pull', Path(__file__).with_name('pull-fletch-backups.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PullTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        os.chmod(self.root, 0o700)
        self.content = b'controlled synthetic archive'
        self.receipt = {'file': 'fletch-20260909-230158-030.dump', 'bytes': len(self.content), 'sha256': hashlib.sha256(self.content).hexdigest(), 'at': '2026-09-09T23:02:44Z'}
        self.args = types.SimpleNamespace(host='fixture@localhost', key='/fixture-only', destination=str(self.root))
        self.downloads = 0

    def command(self, command, **kwargs):
        if command[0] == 'ssh':
            return types.SimpleNamespace(stdout=json.dumps([self.receipt]))
        self.downloads += 1
        Path(command[-1]).write_bytes(self.content)
        return types.SimpleNamespace(returncode=0)

    def test_verified_copy_then_idempotent_repeat(self):
        with patch.object(module.subprocess, 'run', side_effect=self.command):
            receipt = module.pull(self.args)
            self.assertTrue(receipt['archives'][0]['downloaded'])
            self.assertFalse(module.pull(self.args)['archives'][0]['downloaded'])
        self.assertEqual(self.downloads, 1)
        self.assertEqual((self.root / self.receipt['file']).stat().st_mode & 0o777, 0o600)

    def test_bad_hash_never_publishes_and_cleans_partial(self):
        self.receipt['sha256'] = '0' * 64
        with patch.object(module.subprocess, 'run', side_effect=self.command):
            with self.assertRaisesRegex(ValueError, 'verification'):
                module.pull(self.args)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_remote_path_traversal_rejected_before_download(self):
        self.receipt['file'] = '../credentials'
        with patch.object(module.subprocess, 'run', side_effect=self.command):
            with self.assertRaises(ValueError):
                module.pull(self.args)
        self.assertEqual(self.downloads, 0)

    def test_public_destination_rejected(self):
        os.chmod(self.root, 0o755)
        with self.assertRaisesRegex(ValueError, 'private'):
            module.pull(self.args)


if __name__ == '__main__':
    unittest.main()
