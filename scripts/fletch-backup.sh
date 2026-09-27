#!/usr/bin/env bash
# Nightly database backup. Parse dotenv literally; never execute its secret values.
set -euo pipefail
umask 077
exec flock --nonblock "${FLETCH_BACKUP_LOCK_PATH:-/run/lock/fletch-backup.lock}" node --input-type=module - "$@" <<'JS'
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, open, readFile, readdir, rename, stat, statfs, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const options = { '--env-file': '/etc/fletch/fletch.env', '--dest': '/var/backups/fletch', '--keep-days': '14', '--reserve-bytes': String(5 * 1024 ** 3) };
let stage = 'configuration';
let partial;
try {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    if (!Object.hasOwn(options, args[index]) || args[index + 1] === undefined) throw new Error('invalid_option');
    options[args[index]] = args[index + 1];
  }
  const keepDays = Number(options['--keep-days']);
  const reserve = Number(options['--reserve-bytes']);
  const destination = options['--dest'];
  if (!isAbsolute(destination) || !isAbsolute(options['--env-file']) || !Number.isInteger(keepDays) || keepDays < 1 || keepDays > 365 || !Number.isSafeInteger(reserve) || reserve < 0) throw new Error('invalid_configuration');
  const config = parseEnv(await readFile(options['--env-file'], 'utf8'));
  const database = new URL(config.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname || !database.pathname.slice(1)) throw new Error('invalid_database');
  // libpq receives credentials through its environment, never argv or log output.
  const childEnv = { PATH: process.env.PATH, LANG: 'C', PGCONNECT_TIMEOUT: '10',
    PGHOST: database.hostname.replace(/^\[|\]$/g, ''), PGPORT: database.port || '5432',
    PGDATABASE: decodeURIComponent(database.pathname.slice(1)), PGUSER: decodeURIComponent(database.username), PGPASSWORD: decodeURIComponent(database.password) };
  const parameters = { sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', sslpassword: 'PGSSLPASSWORD', options: 'PGOPTIONS', application_name: 'PGAPPNAME', connect_timeout: 'PGCONNECT_TIMEOUT', channel_binding: 'PGCHANNELBINDING', target_session_attrs: 'PGTARGETSESSIONATTRS' };
  for (const [key, value] of database.searchParams) {
    if (!Object.hasOwn(parameters, key)) throw new Error('unsupported_database_parameter');
    childEnv[parameters[key]] = value;
  }
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await chmod(destination, 0o700);
  stage = 'disk_preflight';
  const databaseBytes = Number(execFileSync('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--command', 'select pg_database_size(current_database())'], { env: childEnv, encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  if (!Number.isSafeInteger(databaseBytes) || databaseBytes < 0) throw new Error('invalid_size');
  const disk = await statfs(destination);
  const available = disk.bavail * disk.bsize;
  const required = Math.max(databaseBytes * 2, 1024 ** 3) + reserve;
  if (available < required) throw new Error('insufficient_disk');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace('Z', '');
  const name = `fletch-${stamp}.dump`;
  const final = join(destination, name);
  partial = `${final}.partial-${process.pid}`;
  const reserved = await open(partial, 'wx', 0o600);
  await reserved.close();
  stage = 'database_dump';
  execFileSync('pg_dump', ['--format=custom', '--compress=6', '--no-owner', '--no-privileges', '--file', partial], { env: childEnv, timeout: 30 * 60_000, stdio: 'ignore' });
  stage = 'archive_verification';
  execFileSync('pg_restore', ['--list', partial], { env: childEnv, timeout: 30_000, stdio: 'ignore' });
  const info = await stat(partial);
  if (!info.size) throw new Error('empty_dump');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(partial)) hash.update(chunk);
  const handle = await open(partial, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
  await rename(partial, final);
  partial = undefined;
  const receipt = { at: new Date().toISOString(), file: name, bytes: info.size, sha256: hash.digest('hex'), databaseBytes, availableBefore: available, requiredBefore: required, verified: 'pg_restore --list' };
  const receiptHandle = await open(`${final}.json`, 'wx', 0o600);
  try { await receiptHandle.writeFile(JSON.stringify(receipt) + '\n'); await receiptHandle.sync(); } finally { await receiptHandle.close(); }
  const directoryHandle = await open(destination, 'r');
  try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  stage = 'retention';
  const cutoff = Date.now() - keepDays * 86_400_000;
  for (const file of await readdir(destination)) {
    if (!/^fletch-\d{8}-\d{6}(?:-\d{3})?\.dump$/.test(file) || file === name) continue;
    const path = join(destination, file);
    const old = await stat(path);
    if (old.isFile() && old.mtimeMs < cutoff) {
      await unlink(path);
      await unlink(`${path}.json`).catch(function absent(error) { if (error.code !== 'ENOENT') throw error; });
    }
  }
  console.log(JSON.stringify({ event: 'backup_verified', ...receipt }));
} catch {
  if (partial) await unlink(partial).catch(function absent() {});
  console.error(JSON.stringify({ event: 'backup_failed', stage }));
  process.exitCode = 1;
}
JS
