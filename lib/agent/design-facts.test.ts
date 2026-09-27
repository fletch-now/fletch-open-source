import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { agentTaskPrompt, BUILD_SYSTEM_PROMPT, CHAIN_FACTS, followUpPrompt, repairPrompt, securityRepairPrompt, withBuildFacts } from './chain-facts';
import { DESIGN_FACTS } from './design-facts';
import { needsRepairPrompt } from './needs-rules';

test('all build turn kinds receive the same chain and design facts without replacing the request', function prompts(): void {
  const turns = [agentTaskPrompt('Make a green tracker'), followUpPrompt('Keep the requested neon style'), repairPrompt([{ message: 'Compiler rejected this expression' }]), securityRepairPrompt([{ check: 'reentrancy', impact: 'High', description: 'External call before state update' }]), needsRepairPrompt({ contract: false, wallet: false, reason: 'Public reads', source: 'model' }, ['wallet present'])];
  for (const turn of turns) assert.equal(withBuildFacts(turn), `${CHAIN_FACTS}\n\n${DESIGN_FACTS}\n\n${turn}`);
  assert.ok(BUILD_SYSTEM_PROMPT.startsWith(`${CHAIN_FACTS}\n\n${DESIGN_FACTS}\n\n`));
});

test('starter preparation preserves project edits and refuses to follow an existing destination link', async function preserve(): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), 'fletch-starter-test-'));
  const outside = await mkdtemp(join(tmpdir(), 'fletch-starter-outside-'));
  const prepare = resolve('docker/webapp-template/prepare.mjs');
  try {
    await writeFile(join(workspace, 'index.html'), 'existing app');
    assert.equal(spawnSync(process.execPath, [prepare, workspace]).status, 0);
    assert.equal(await readFile(join(workspace, 'index.html'), 'utf8'), 'existing app');
    const version = JSON.parse(await readFile(join(workspace, 'fletch/template.json'), 'utf8'));
    assert.equal(version.version, '2.0.4');
    await writeFile(join(workspace, 'fletch/tokens.css'), 'user requested colors');
    assert.equal(spawnSync(process.execPath, [prepare, workspace]).status, 0);
    assert.equal(await readFile(join(workspace, 'fletch/tokens.css'), 'utf8'), 'user requested colors');
    await rm(join(workspace, 'fletch'), { recursive: true });
    await symlink(outside, join(workspace, 'fletch'));
    assert.equal(spawnSync(process.execPath, [prepare, workspace]).status, 0);
    await assert.rejects(readFile(join(outside, 'tokens.css')), { code: 'ENOENT' });
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('initial and follow-up instructions preserve Phantom and browser wallets without a Reown ID', function walletFacts(): void {
  for (const prompt of [withBuildFacts(agentTaskPrompt('Build a signing app')), withBuildFacts(followUpPrompt('Keep my neon glass design'))]) {
    assert.match(prompt, /Phantom/);
    assert.match(prompt, /EIP-6963/);
    assert.doesNotMatch(prompt, /then the template wallet explains that connection is unavailable/);
    assert.match(prompt, /Explicit user aesthetics override/);
  }
});
