import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { canRetainWorker } from './deploy-build-drain.mjs';

function snapshot() {
  return {
    deployment: { worker: '0', registry: '0', image: '', proxyBind: '' }, configuredExecution: 'worker',
    web: { pid: '100', state: 'active', execution: 'worker', cwd: '/opt/fletch/app/.next/standalone', cgroup: '/system.slice/fletch.service' },
    worker: { pid: '200', state: 'active', execution: 'worker', cwd: '/opt/fletch/build-worker', cgroup: '/system.slice/fletch-build-worker.service',
      partOf: '', bindsTo: '', requires: 'sysinit.target -.mount system.slice', port: '3902', bind: '172.17.0.1' },
    listener: 'LISTEN 0 511 172.17.0.1:3902 0.0.0.0:* users:(("node",pid=200,fd=22))',
    builds: [{ worker_state: 'running', has_owner: true, lease_live: true }],
  };
}

test('a web-only release retains the independently owned active build and private proxy', () => {
  assert.equal(canRetainWorker(snapshot()), true);
});

test('worker, registry, image or proxy changes retain the full drain', () => {
  for (const [key, value] of [['worker', '1'], ['registry', '1'], ['image', 'new-image'], ['proxyBind', '172.17.0.2']]) {
    const proof = snapshot(); proof.deployment[key] = value;
    assert.equal(canRetainWorker(proof), false, key);
  }
});

test('legacy, queued, ownerless and expired execution cannot bypass the drain', () => {
  for (const build of [
    { worker_state: null, has_owner: false, lease_live: null },
    { worker_state: 'queued', has_owner: false, lease_live: null },
    { worker_state: 'running', has_owner: false, lease_live: true },
    { worker_state: 'running', has_owner: true, lease_live: false },
    { worker_state: 'recovery_required', has_owner: true, lease_live: true },
  ]) {
    const proof = snapshot(); proof.builds.push(build);
    assert.equal(canRetainWorker(proof), false, JSON.stringify(build));
  }
});

test('web-owned, coupled, stopped or incorrectly routed execution keeps the full drain', () => {
  for (const [key, value] of [
    ['pid', '100'], ['state', 'inactive'], ['execution', 'legacy'], ['cwd', '/opt/fletch/app'],
    ['cgroup', '/system.slice/fletch.service'], ['partOf', 'fletch.service'], ['bindsTo', 'fletch.service'],
    ['requires', 'fletch.service'], ['port', '3901'], ['bind', '0.0.0.0'],
  ]) {
    const proof = snapshot(); proof.worker[key] = value;
    assert.equal(canRetainWorker(proof), false, key);
  }
  for (const listener of ['', 'LISTEN 0 511 172.17.0.1:3902 0.0.0.0:* users:(("node",pid=100,fd=22))']) {
    const proof = snapshot(); proof.listener = listener;
    assert.equal(canRetainWorker(proof), false);
  }
  const proof = snapshot(); proof.configuredExecution = 'legacy';
  assert.equal(canRetainWorker(proof), false);
});

test('the deployment EXIT handler restores the gate and preserves TERM status', () => {
  const source = readFileSync(new URL('./deploy-legacy.sh', import.meta.url), 'utf8');
  const handler = source.match(/finish_deploy\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(handler);
  const result = spawnSync('bash', ['-c', `${handler}\nrestore_build_submissions() { echo gate-restored; }\ntrap finish_deploy EXIT\ntrap 'exit 143' TERM\nkill -TERM $$`], { encoding: 'utf8' });
  assert.equal(result.status, 143);
  assert.equal(result.stdout.trim(), 'gate-restored');
  const failure = spawnSync('bash', ['-c', `${handler}\nrestore_build_submissions() { return 1; }\ntrap finish_deploy EXIT\nexit 0`], { encoding: 'utf8' });
  assert.equal(failure.status, 1);
});
