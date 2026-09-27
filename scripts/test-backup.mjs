// Linux-only backup fixture runs in a local network-disabled container on macOS.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
const run = promisify(execFile);

if (!process.argv.includes('--inside')) {
  const fixture = await mkdtemp(join(tmpdir(), 'fletch-backup-fixture-'));
  try {
    const result = await run('docker', ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', '0:0', '--tmpfs', '/tmp',
      '-v', `${fixture}:/fixture`, '-v', `${resolve('scripts/fletch-backup.sh')}:/backup.sh:ro`, '-v', `${resolve('scripts/test-backup.mjs')}:/test-backup.mjs:ro`,
      '-e', 'PATH=/fixture/bin:/usr/local/bin:/usr/bin:/bin', '--entrypoint', 'node', process.env.FLETCH_TEST_WEB_IMAGE ?? 'fletch-agent:clock-v2.0.2-20260909', '/test-backup.mjs', '--inside'], { timeout: 60_000 });
    console.log(result.stdout.trim());
  } finally { await rm(fixture, { recursive: true, force: true }); }
} else {
  const checks = [];
  await mkdir('/fixture/bin');
  const helper = `#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';
const mode=fs.readFileSync('/fixture/scenario','utf8');const name=path.basename(process.argv[1]);
if(process.env.PGPASSWORD!=='synthetic$literal#password'||process.env.PGUSER!=='fixture'||process.env.PGDATABASE!=='fixture'||process.env.ADMIN_PASSWORD_HASH!==undefined||process.argv.some(a=>a.includes('synthetic')))process.exit(31);
if(name==='psql'){console.log(mode==='disk-full'?'9000000000000000':'1024');process.exit(0)}
if(name==='pg_restore'){if(mode==='bad-archive')process.exit(3);const p=process.argv.at(-1);if(!fs.readFileSync(p).toString().startsWith('PGDMP fixture'))process.exit(4);process.exit(0)}
const file=process.argv[process.argv.indexOf('--file')+1];fs.writeFileSync('/fixture/dispatched','yes');fs.writeFileSync(file,'PGDMP fixture data');
if(mode==='failed-dump'){console.error('synthetic$literal#password');process.exit(2)}
if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,1000));
`;
  for (const name of ['psql', 'pg_dump', 'pg_restore']) await writeFile(`/fixture/bin/${name}`, helper, { mode: 0o755 });
  const config = 'DATABASE_URL="postgresql://fixture:synthetic%24literal%23password@127.0.0.1:5432/fixture?sslmode=disable"\nADMIN_PASSWORD_HASH="scrypt$unbound$literal"\nDO_NOT_EXECUTE=$(touch /fixture/injected)\n';
  await writeFile('/fixture/fletch.env', config, { mode: 0o600 });
  async function backup(mode) {
    await writeFile('/fixture/scenario', mode);
    return run('/bin/bash', ['/backup.sh', '--env-file', '/fixture/fletch.env', '--dest', '/fixture/backups', '--reserve-bytes', '0', '--keep-days', '1'], { env: { ...process.env, FLETCH_BACKUP_LOCK_PATH: '/fixture/backup.lock' } });
  }
  let result = await backup('success');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.event, 'backup_verified');
  assert.equal(receipt.sha256, createHash('sha256').update(await readFile(`/fixture/backups/${receipt.file}`)).digest('hex'));
  assert.equal((await stat(`/fixture/backups/${receipt.file}`)).mode & 0o777, 0o600);
  assert.equal((await stat('/fixture/backups')).mode & 0o777, 0o700);
  await assert.rejects(stat('/fixture/injected'), { code: 'ENOENT' });
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic|unbound|scrypt/);
  checks.push('literal dotenv parsing, no code execution, private verified checksum and no credential argv/output');
  for (const mode of ['failed-dump', 'bad-archive']) {
    const before = (await readdir('/fixture/backups')).sort();
    await assert.rejects(backup(mode), function failed(error) {
      assert.doesNotMatch(error.stdout + error.stderr, /synthetic|scrypt/);
      assert.equal(JSON.parse(error.stderr).event, 'backup_failed');
      return error.code === 1;
    });
    assert.deepEqual((await readdir('/fixture/backups')).sort(), before);
    checks.push(`${mode} removes partial and preserves previous backups`);
  }
  await rm('/fixture/dispatched');
  await assert.rejects(backup('disk-full'), function failed(error) { return JSON.parse(error.stderr).stage === 'disk_preflight'; });
  await assert.rejects(stat('/fixture/dispatched'), { code: 'ENOENT' });
  checks.push('disk preflight blocks dump before dispatch');
  await writeFile('/fixture/backups/fletch-20000101-000000.dump', 'old');
  await writeFile('/fixture/backups/manual-release.dump', 'retained');
  await utimes('/fixture/backups/fletch-20000101-000000.dump', 0, 0);
  await utimes('/fixture/backups/manual-release.dump', 0, 0);
  await backup('success');
  await assert.rejects(stat('/fixture/backups/fletch-20000101-000000.dump'), { code: 'ENOENT' });
  assert.equal(await readFile('/fixture/backups/manual-release.dump', 'utf8'), 'retained');
  checks.push('retention prunes only aged scheduled dumps after new backup verifies');
  await rm('/fixture/dispatched');
  const first = backup('slow');
  while (!(await stat('/fixture/dispatched').catch(function absent() { return null; }))) await delay(10);
  await assert.rejects(run('/bin/bash', ['/backup.sh', '--env-file', '/fixture/fletch.env', '--dest', '/fixture/backups'], { env: { ...process.env, FLETCH_BACKUP_LOCK_PATH: '/fixture/backup.lock' } }), { code: 1 });
  await first;
  checks.push('flock rejects overlapping manual/timer runs');
  await writeFile('/fixture/fletch.env', 'DATABASE_URL="not-a-postgres-url"\n');
  await assert.rejects(backup('success'), function failed(error) { return JSON.parse(error.stderr).stage === 'configuration'; });
  checks.push('invalid connection fails closed without logging environment');
  console.log(JSON.stringify({ at: new Date().toISOString(), passed: true, checks, limitations: ['Postgres binaries are controlled stand-ins; root must run a real dump/list and separate restore drill after installation.'], credentialsPrinted: false }, null, 2));
}
