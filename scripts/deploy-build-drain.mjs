import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';

// A web release may retain execution only when it is owned outside the web unit.
export function canRetainWorker({ deployment, configuredExecution, web, worker, listener, builds }) {
  if (deployment.worker !== '0' || deployment.registry !== '0' || deployment.image || deployment.proxyBind) return false;
  if (configuredExecution !== 'worker' || web.execution !== 'worker' || worker.execution !== 'worker') return false;
  if (web.state !== 'active' || worker.state !== 'active' || !worker.pid || web.pid === worker.pid) return false;
  if (worker.cwd !== '/opt/fletch/build-worker' || web.cwd !== '/opt/fletch/app/.next/standalone') return false;
  if (worker.cgroup !== '/system.slice/fletch-build-worker.service' || web.cgroup !== '/system.slice/fletch.service') return false;
  if (worker.partOf || worker.bindsTo || worker.requires.split(/\s+/).includes('fletch.service')) return false;
  if (worker.port !== '3902' || worker.bind !== '172.17.0.1') return false;
  if (!listener.split('\n').some((line) => line.trim().split(/\s+/)[3] === '172.17.0.1:3902' && line.includes(`pid=${worker.pid},`))) return false;
  return builds.every((build) => build.worker_state === 'running' && build.has_owner === true && build.lease_live === true);
}

function serviceSnapshot(unit) {
  const output = execFileSync('systemctl', ['show', unit, '-p', 'MainPID', '-p', 'ActiveState', '-p', 'ControlGroup', '-p', 'PartOf', '-p', 'BindsTo', '-p', 'Requires'], { encoding: 'utf8', timeout: 5000 });
  const values = Object.fromEntries(output.trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  if (!/^[1-9]\d*$/.test(values.MainPID)) throw new Error('Service has no live process');
  const entries = readFileSync(`/proc/${values.MainPID}/environ`, 'utf8').split('\0');
  function env(name) { return entries.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''; }
  return { pid: values.MainPID, state: values.ActiveState, cgroup: values.ControlGroup, partOf: values.PartOf,
    bindsTo: values.BindsTo, requires: values.Requires, cwd: realpathSync(`/proc/${values.MainPID}/cwd`),
    execution: env('FORGE_BUILD_EXECUTION'), port: env('FORGE_PROXY_PORT'), bind: env('FORGE_PROXY_BIND') };
}

export async function readDeployDrain(pool, deployment, configuredExecution) {
  let runtime = null;
  // Unknown process ownership or an unavailable inspection keeps the full drain.
  try {
    runtime = { web: serviceSnapshot('fletch.service'), worker: serviceSnapshot('fletch-build-worker.service'),
      listener: execFileSync('ss', ['-H', '-ltnp', '( sport = :3902 )'], { encoding: 'utf8', timeout: 5000 }) };
  } catch { /* retain the existing full-drain behavior */ }
  // Read leases after process inspection so a slow inspection cannot reuse an expired lease.
  const result = await pool.query(`select j.state as worker_state,j.owner_id is not null as has_owner,
    j.lease_expires_at > clock_timestamp() as lease_live from builds b
    left join build_worker_jobs j on j.build_id=b.id
    where b.status in ('queued','provisioning','building','compiling')`);
  const retain = runtime !== null && canRetainWorker({ ...runtime, deployment, configuredExecution, builds: result.rows });
  return { count: retain ? 0 : result.rows.length, activeBuilds: result.rows.length, mode: retain ? 'worker-web' : 'full' };
}
