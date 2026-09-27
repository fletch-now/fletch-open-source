#!/usr/bin/env python3
"""Exercise the real remote deployment shell in a disposable local filesystem."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
REMOTE = (ROOT / 'scripts/deploy-legacy.sh').read_text().split("<<'REMOTE'\n", 1)[1].split('\nREMOTE\n', 1)[0]

STUB = r'''
import json, os, pathlib, subprocess, sys
root = pathlib.Path(os.environ['FIXTURE_ROOT'])
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
state_path = root/'state.json'
state = json.loads(state_path.read_text())
scenario = os.environ['FIXTURE_SCENARIO']
def save():
    state_path.write_text(json.dumps(state))
def log(event):
    with (root/'events.jsonl').open('a') as stream:
        stream.write(json.dumps(event)+'\n')
def revision(service):
    path = root/('opt/fletch/build-worker' if service == 'fletch-build-worker' else 'opt/fletch/app')/'revision'
    return path.read_text().strip() if path.exists() else 'missing'
if name == 'sudo':
    if args[:2] != ['-u','fletch']: sys.exit(90)
    sys.exit(subprocess.run(args[2:]).returncode)
if name == 'node':
    source = sys.stdin.read()
    if 'const dotenv' in source:
        print('fixture-only' if args[-1] == 'DATABASE_URL' else 'fixture-reown', end='')
    elif 'readDeployDrain' in source:
        state['counts'] += 1
        log({'event':'drain','count':state['counts']})
        save()
        print(('1' if state['counts'] == 1 else '0') + ' full', end='')
    else: sys.exit(91)
    sys.exit(0)
if name == 'ps':
    if '-C' in args: print('12345 nginx: worker process')
    elif state['counts'] == 0: print('nginx: worker process')
    sys.exit(0)
if name in ['npm','npx','sleep','chown','nginx','systemd-analyze']:
    sys.exit(0)
if name == 'curl':
    log({'event':'web-health','revision':revision('fletch')})
    sys.exit(1 if scenario in ['web-health-failure','rollback-failure'] and revision('fletch') == 'new' else 0)
if name != 'systemctl': sys.exit(92)
operation = args[0]
service = args[-1]
if operation == 'list-unit-files': sys.exit(1)
if operation == 'daemon-reload':
    log({'event':'daemon-reload'})
    sys.exit(0)
if service == 'nginx':
    gated = 'Retry-After' in (root/'etc/nginx/sites-enabled/fletch').read_text()
    log({'event':'nginx-reload','gated':gated})
    sys.exit(0)
if service not in ['fletch','fletch-build-worker']: sys.exit(93)
log({'event':operation,'service':service,'revision':revision(service)})
if operation == 'stop':
    assert 'Retry-After' in (root/'etc/nginx/sites-enabled/fletch').read_text(), 'Worker stop must be gated'
    assert state['counts'] >= 2, 'Worker stop must follow the drain'
    state[service] = False
    state['stops'] += 1
    save()
    sys.exit(1 if scenario == 'stop-failure' and state['stops'] == 1 else 0)
if operation in ['start','restart']:
    failed = service == 'fletch-build-worker' and ((scenario == 'worker-start-failure' and revision(service) == 'new') or (scenario == 'rollback-failure' and revision(service) == 'old-worker'))
    state[service] = not failed
    save()
    sys.exit(1 if failed else 0)
if operation == 'is-active':
    if service == 'fletch-build-worker' and scenario == 'worker-late-failure' and revision('fletch') == 'new' and revision(service) == 'new': sys.exit(1)
    sys.exit(0 if state[service] else 3)
sys.exit(94)
'''


class WorkerDeploymentTest(unittest.TestCase):
    def test_invalid_flag_stops_before_connecting(self):
        result = subprocess.run(['bash', str(ROOT/'scripts/deploy.sh')], env={**os.environ, 'DEPLOY_BUILD_WORKER':'yes'}, text=True, capture_output=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('DEPLOY_BUILD_WORKER must be 0 or 1', result.stdout)
        self.assertNotIn('syncing', result.stdout)

    def scenario(self, scenario, deploy_worker=True):
        with tempfile.TemporaryDirectory(prefix='fletch-deploy-worker-test-') as temporary:
            root = Path(temporary)
            for name in ['opt/fletch/stage/scripts', 'opt/fletch/stage/.next/static', 'opt/fletch/stage/.next/standalone/.next', 'opt/fletch/stage/public', 'opt/fletch/app', 'opt/fletch/build-worker', 'etc/systemd/system', 'etc/nginx/sites-enabled', 'etc/fletch', 'var/lib/fletch/workspaces', 'run', 'bin']:
                (root/name).mkdir(parents=True, exist_ok=True)
            original_nginx = 'server {\n  server_name builder.example.com;\n}\n'
            (root/'etc/nginx/sites-enabled/fletch').write_text(original_nginx)
            (root/'etc/fletch/fletch.env').write_text('PRESERVE=environment\n')
            (root/'var/lib/fletch/workspaces/retained-source').write_text('preserve project data')
            (root/'opt/fletch/app/revision').write_text('old-web')
            (root/'opt/fletch/build-worker/revision').write_text('old-worker')
            (root/'opt/fletch/stage/revision').write_text('new')
            unit = root/'etc/systemd/system/fletch-build-worker.service'
            unit.write_text('old unit\n')
            (root/'opt/fletch/stage/scripts/fletch-build-worker.service').write_text('new unit\n')
            (root/'state.json').write_text(json.dumps({'fletch':True, 'fletch-build-worker':True, 'counts':0, 'stops':0}))
            for name in ['sudo','node','npm','npx','systemctl','systemd-analyze','nginx','curl','sleep','ps','chown']:
                executable = root/'bin'/name
                executable.write_text('#!'+sys.executable+'\n'+STUB)
                executable.chmod(0o755)
            shell = REMOTE
            for prefix in ['/opt/fletch', '/etc/fletch', '/etc/nginx', '/etc/systemd', '/run/fletch']:
                shell = shell.replace(prefix, str(root)+prefix)
            environment = {**os.environ, 'PATH':str(root/'bin')+os.pathsep+os.environ['PATH'], 'FIXTURE_ROOT':str(root), 'FIXTURE_SCENARIO':scenario, 'DEPLOY_BUILD_WORKER':'1' if deploy_worker else '0', 'DEPLOY_AGENT_IMAGE':'', 'DEPLOY_PROXY_BIND':'', 'DEPLOY_REGISTRY':'0'}
            result = subprocess.run(['bash','-s'], input=shell, text=True, capture_output=True, env=environment, timeout=30)
            events = [json.loads(line) for line in (root/'events.jsonl').read_text().splitlines()]
            failed = scenario != 'success'
            self.assertEqual(result.returncode != 0, failed, result.stdout+'\n'+result.stderr)
            self.assertEqual((root/'etc/fletch/fletch.env').read_text(), 'PRESERVE=environment\n')
            self.assertEqual((root/'var/lib/fletch/workspaces/retained-source').read_text(), 'preserve project data')
            self.assertFalse(list((root/'opt/fletch').glob('build-worker-deploy.*')))
            if scenario == 'rollback-failure':
                self.assertIn('Retry-After', (root/'etc/nginx/sites-enabled/fletch').read_text())
                self.assertFalse(any(event['event'] == 'nginx-reload' and not event['gated'] for event in events))
                self.assertIn('rollback failed', result.stdout)
            else:
                self.assertEqual((root/'etc/nginx/sites-enabled/fletch').read_text(), original_nginx)
            expected_worker = 'new' if deploy_worker and not failed else 'old-worker'
            self.assertEqual((root/'opt/fletch/build-worker/revision').read_text(), expected_worker)
            self.assertEqual(unit.read_text(), 'new unit\n' if expected_worker == 'new' else 'old unit\n')
            if deploy_worker:
                self.assertEqual((root/'opt/fletch/build-worker-prev.service').read_text(), 'old unit\n')
                if scenario != 'stop-failure': self.assertEqual((root/'opt/fletch/build-worker-prev/revision').read_text(), 'old-worker')
                if not failed:
                    self.assertEqual((root/'opt/fletch/app/revision').read_text(), 'new')
                    self.assertEqual((root/'opt/fletch/app-prev/revision').read_text(), 'old-web')
                    release_index = next(index for index,event in enumerate(events) if event['event'] == 'nginx-reload' and not event['gated'])
                    self.assertTrue(any(event['event'] == 'is-active' and event.get('service') == 'fletch-build-worker' and event.get('revision') == 'new' for event in events[:release_index]))
                elif scenario != 'rollback-failure':
                    self.assertEqual((root/'opt/fletch/app/revision').read_text(), 'old-web')
                    self.assertTrue(json.loads((root/'state.json').read_text())['fletch-build-worker'])
            else:
                self.assertFalse(any(event.get('service') == 'fletch-build-worker' for event in events))
                self.assertFalse((root/'opt/fletch/build-worker-prev.service').exists())
                self.assertEqual((root/'opt/fletch/app/revision').read_text(), 'new')

    def test_default_web_deploy_preserves_worker(self):
        self.scenario('success', deploy_worker=False)

    def test_joint_release_retains_sources_and_unit(self):
        self.scenario('success')

    def test_worker_start_failure_restores_worker(self):
        self.scenario('worker-start-failure')

    def test_worker_failure_after_web_start_rolls_back_both(self):
        self.scenario('worker-late-failure')

    def test_web_health_failure_rolls_back_both(self):
        self.scenario('web-health-failure')

    def test_incomplete_rollback_keeps_submissions_gated(self):
        self.scenario('rollback-failure')

    def test_failed_worker_stop_restores_service_without_source_swap(self):
        self.scenario('stop-failure')


if __name__ == '__main__':
    unittest.main()
