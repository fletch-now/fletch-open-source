"""Offline checks for DNS scope, cleanup, credential handling and failure behavior."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('namesilo_dns', Path(__file__).with_name('fletch-namesilo-dns.py'))
dns = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dns)
VALUE = 'a' * 43


def record(identity='created', value=VALUE, host=dns.HOST, kind='TXT'):
    return {'record_id': identity, 'type': kind, 'host': host, 'value': value}


class DNSHookTests(unittest.TestCase):
    def test_only_certificate_names_and_valid_challenges_are_accepted(self):
        for domain in ['apps.example.com', '*.apps.example.com']:
            with patch.dict(os.environ, CERTBOT_DOMAIN=domain, CERTBOT_VALIDATION=VALUE):
                self.assertEqual(dns.challenge(), VALUE)
        for domain in ['builder.example.com', 'attacker.example', 'apps.example.com.attacker.example']:
            with patch.dict(os.environ, CERTBOT_DOMAIN=domain, CERTBOT_VALIDATION=VALUE):
                with self.assertRaises(dns.DNSFailure):
                    dns.challenge()
        with patch.dict(os.environ, CERTBOT_DOMAIN='apps.example.com', CERTBOT_VALIDATION='bad value'):
            with self.assertRaises(dns.DNSFailure):
                dns.challenge()

    def test_cleanup_preserves_every_other_record_and_is_idempotent(self):
        entries = [record(), record('second', 'b' * 43), record('traffic', '192.0.2.10', 'apps.example.com', 'A')]
        with patch.object(dns, 'records', return_value=entries), patch.object(dns, 'api') as api:
            dns.delete_owned('secret', 'created', VALUE)
            api.assert_called_once_with('secret', 'dnsDeleteRecord', rrid='created')
        with patch.object(dns, 'records', return_value=entries[1:]), patch.object(dns, 'api') as api:
            dns.delete_owned('secret', 'created', VALUE)
            api.assert_not_called()

    def test_cleanup_rejects_a_changed_record(self):
        with patch.object(dns, 'records', return_value=[record(value='changed')]), patch.object(dns, 'api') as api:
            with self.assertRaises(dns.DNSFailure):
                dns.delete_owned('secret', 'created', VALUE)
            api.assert_not_called()

    def test_auth_adds_only_the_validation_txt_and_passes_its_identity_to_cleanup(self):
        with patch.object(dns, 'records', return_value=[]), patch.object(dns, 'api', return_value={'record_id': 'created'}) as api, patch.object(dns, 'wait_for_dns') as wait, contextlib.redirect_stdout(io.StringIO()) as output:
            dns.authenticate('secret', VALUE)
            api.assert_called_once_with('secret', 'dnsAddRecord', rrtype='TXT', rrhost='_acme-challenge.apps', rrvalue=VALUE, rrttl='3600')
            wait.assert_called_once_with(VALUE)
            self.assertEqual(output.getvalue().strip(), 'created')

    def test_reusing_an_existing_txt_does_not_claim_ownership(self):
        with patch.object(dns, 'records', return_value=[record()]), patch.object(dns, 'api') as api, patch.object(dns, 'wait_for_dns'), contextlib.redirect_stdout(io.StringIO()) as output:
            dns.authenticate('secret', VALUE)
            api.assert_not_called()
            self.assertEqual(output.getvalue().strip(), '')

    def test_propagation_failure_removes_only_the_created_txt(self):
        with patch.object(dns, 'records', return_value=[]), patch.object(dns, 'api', return_value={'record_id': 'created'}), patch.object(dns, 'wait_for_dns', side_effect=dns.DNSFailure('timeout')), patch.object(dns, 'delete_owned') as cleanup:
            with self.assertRaises(dns.DNSFailure):
                dns.authenticate('secret', VALUE)
            cleanup.assert_called_once_with('secret', 'created', VALUE)

    def test_delegated_validation_name_is_preserved(self):
        with patch.object(dns, 'records', return_value=[record(kind='CNAME')]), patch.object(dns, 'api') as api:
            with self.assertRaises(dns.DNSFailure):
                dns.authenticate('secret', VALUE)
            api.assert_not_called()

    def test_api_failure_does_not_expose_the_credential(self):
        key = 'SECRET-MUST-NOT-BE-LOGGED'
        with patch.object(dns, 'build_opener', side_effect=RuntimeError('https://example/?key=' + key)):
            with self.assertRaises(dns.DNSFailure) as result:
                dns.api(key, 'dnsListRecords')
            self.assertNotIn(key, str(result.exception))

    def test_automation_uses_batch_and_encodes_the_key_inside_the_request(self):
        class Response(io.BytesIO):
            pass
        with patch.object(dns, 'build_opener') as opener:
            opener.return_value.open.return_value = Response(b'{"reply":{"code":300}}')
            self.assertEqual(dns.api('secret', 'dnsListRecords'), {'code': 300})
            url = opener.return_value.open.call_args.args[0]
            self.assertTrue(url.startswith('https://www.namesilo.com/apibatch/dnsListRecords?'))
            self.assertIn('domain=builder.example.com', url)

    def test_missing_or_shared_credentials_fail_before_network_access(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'key'
            with patch.object(dns, 'KEY', path):
                with self.assertRaises(dns.DNSFailure):
                    dns.read_key()
                path.write_text('a' * 30)
                path.chmod(0o644)
                with self.assertRaises(dns.DNSFailure):
                    dns.read_key()
                path.unlink()
                path.symlink_to(Path(directory) / 'other')
                with self.assertRaises(dns.DNSFailure):
                    dns.read_key()

    def test_dns_requires_all_authoritative_and_public_resolvers(self):
        calls = []
        def lookup(server, host, kind):
            calls.append((server, host, kind))
            return ['ns1.dnsowl.com.', 'ns2.dnsowl.com.'] if kind == 'NS' else ['"' + VALUE + '"']
        with patch.object(dns, 'dig', side_effect=lookup):
            dns.wait_for_dns(VALUE)
        self.assertEqual([server for server, _, kind in calls if kind == 'TXT'], ['ns1.dnsowl.com', 'ns2.dnsowl.com', '1.1.1.1', '8.8.8.8'])


if __name__ == '__main__':
    unittest.main()
