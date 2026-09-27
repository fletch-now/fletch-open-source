import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/lib/db/schema";
import { sandboxArgs } from "@/lib/agent/sandbox";
import { claimNextBuild, readBuildQueue } from "./queue";
import { claimWorkerBuild } from "./durable/ownership";
import {
  BUILD_CAPACITY_KEY, inspectBuildCapacity, inspectCapacityResources, parseCapacity, parseCapacitySetting,
  readBuildCapacity, sandboxLimits, setBuildCapacity, validatedWorkerCapacity, type CapacityResources,
  inspectSharedCapacityResources, parseCapacityPressure, hasSharedMemoryRoom, SHARED_BUILD_ADMISSION, sharedAdmissionForResources, type CapacityProfile,
} from "./capacity";

const GIB = 1024 ** 3;
const SMALL: CapacityResources = {
  hostId: "a".repeat(64), platform: "linux", workerExecution: true, sandboxEnabled: true, logicalCpus: 4, totalMemoryBytes: 15.61 * GIB,
  sandboxMemoryBytes: 2 * GIB, sandboxCpus: 2, cgroupParent: "fletch-builds.slice",
  cgroupDriver: "systemd", cgroupCpuQuota: 3, cgroupMemoryBytes: 10 * GIB,
};
const LARGE: CapacityResources = { ...SMALL, logicalCpus: 80, totalMemoryBytes: 192 * GIB, cgroupCpuQuota: 60, cgroupMemoryBytes: 140 * GIB };

test("capacity preflight distinguishes eligibility from current capacity and rejects malformed limits", function resources() {
  assert.equal(inspectCapacityResources(SMALL).eligibleMaximum, 3);
  assert.equal(inspectCapacityResources(LARGE).eligibleMaximum, 50);
  assert.equal(inspectCapacityResources({ ...LARGE, workerExecution: false }).eligibleMaximum, 2);
  assert.equal(inspectCapacityResources({ ...LARGE, sandboxEnabled: false }).eligibleMaximum, 2);
  assert.equal(inspectCapacityResources({ ...SMALL, cgroupCpuQuota: Infinity }).eligibleMaximum, 0);
  assert.equal(inspectCapacityResources({ ...SMALL, sandboxCpus: NaN }).eligibleMaximum, 0);
  assert.equal(inspectCapacityResources({ ...SMALL, cgroupCpuQuota: null }).eligibleMaximum, 2);
  assert.equal(inspectCapacityResources({ ...SMALL, cgroupDriver: "cgroupfs" }).eligibleMaximum, 2);
  assert.equal(inspectCapacityResources({ ...SMALL, cgroupCpuQuota: 4 }).eligibleMaximum, 0);
  assert.ok(inspectCapacityResources({ ...SMALL, cgroupMemoryBytes: 14 * GIB }).eligibleMaximum < 3);
  for (const value of ["", "0", "101", "NaN", "Infinity", "1.5", " 2", "2e0", null, false, {}]) assert.throws(() => parseCapacity(value));
  assert.equal(parseCapacity("100"), 100);
  for (const value of ["not-json", "{}", '{"capacity":50}', 2]) assert.throws(() => parseCapacitySetting(value));
  for (const memory of ["0", "1m", "unlimited", "2.5g", "-2g", "999999999999999999g"]) assert.throws(() => sandboxLimits({ FORGE_AGENT_MEMORY: memory }));
  for (const parent of ["/system.slice", "system.slice", "../fletch-builds.slice", "fletch-builds.scope", ""]) assert.throws(() => sandboxLimits({ FORGE_SANDBOX_CGROUP_PARENT: parent }));
  assert.deepEqual(sandboxLimits({ FORGE_AGENT_MEMORY: "2048m", FORGE_AGENT_CPUS: "2", FORGE_SANDBOX_CGROUP_PARENT: "fletch-builds.slice" }), { memoryBytes: 2 * GIB, cpus: 2, cgroupParent: "fletch-builds.slice" });
});

test("shared admission has a separate measured eligibility and reserves unmaterialized sessions", function sharedResources() {
  assert.deepEqual(inspectSharedCapacityResources(SMALL), { sharedEligibleMaximum: 100, sharedReasons: [] });
  assert.equal(inspectCapacityResources(SMALL).eligibleMaximum, 3);
  for (const resources of [
    { ...SMALL, cgroupCpuQuota: 4 }, { ...SMALL, cgroupCpuQuota: 2 }, { ...SMALL, cgroupMemoryBytes: 9 * GIB },
    { ...SMALL, cgroupMemoryBytes: 14 * GIB }, { ...SMALL, cgroupDriver: "cgroupfs" }, { ...SMALL, sandboxEnabled: false },
    { ...SMALL, platform: "darwin" }, { ...SMALL, logicalCpus: NaN },
  ]) assert.equal(inspectSharedCapacityResources(resources).sharedEligibleMaximum, 0);
  const room = { sliceMemoryBytes: 0, hostAvailableBytes: 6 * GIB };
  assert.equal(hasSharedMemoryRoom(19, room), true);
  assert.equal(hasSharedMemoryRoom(21, room), false, "Claims reserve memory even before their processes start");
  assert.equal(hasSharedMemoryRoom(0, { ...room, sliceMemoryBytes: 8 * GIB }), false);
  assert.equal(hasSharedMemoryRoom(0, { ...room, sliceMemoryBytes: 8 * GIB - SHARED_BUILD_ADMISSION.reservationBytes }), true);
  assert.equal(hasSharedMemoryRoom(0, { ...room, hostAvailableBytes: 4 * GIB - 1 }), false);
  for (const value of [NaN, Infinity, -1, 0.1]) assert.equal(hasSharedMemoryRoom(0, { ...room, sliceMemoryBytes: value }), false);
  assert.deepEqual(parseCapacityPressure("123\n", "MemTotal: 12345678 kB\nMemAvailable: 4194304 kB\n"), { sliceMemoryBytes: 123, hostAvailableBytes: 4 * GIB });
  for (const current of ["max", "", "-1", "1.5", "9007199254740992"]) assert.throws(() => parseCapacityPressure(current, "MemAvailable: 4194304 kB"));
  for (const meminfo of ["", "MemFree: 100 kB", "MemAvailable: -1 kB", "MemAvailable: 4 GB", "MemAvailable: 9007199254740992 kB"]) assert.throws(() => parseCapacityPressure("0", meminfo));
});

test("memory admission scales to the executor slice while retaining startup reservations", function executorAdmission() {
  const executor = { ...SMALL, logicalCpus: 8, totalMemoryBytes: 31 * GIB, cgroupCpuQuota: 6, cgroupMemoryBytes: 24 * GIB };
  const admission = sharedAdmissionForResources(executor);
  assert.equal(admission.watermarkBytes, 22 * GIB);
  const empty = { sliceMemoryBytes: 0, hostAvailableBytes: 30 * GIB };
  assert.equal(hasSharedMemoryRoom(57, empty, admission), true);
  assert.equal(hasSharedMemoryRoom(58, empty, admission), false);
  assert.equal(hasSharedMemoryRoom(0, { ...empty, sliceMemoryBytes: 22 * GIB }, admission), false);
  assert.equal(sharedAdmissionForResources(SMALL).watermarkBytes, 8 * GIB);
  for (const cgroupMemoryBytes of [null, NaN, Infinity, -1, 0]) {
    assert.equal(hasSharedMemoryRoom(0, empty, sharedAdmissionForResources({ ...executor, cgroupMemoryBytes })), false);
  }
});

test("every sandbox receives the same validated aggregate parent and numeric resource limits", function sandbox() {
  const old = { memory: process.env.FORGE_AGENT_MEMORY, cpus: process.env.FORGE_AGENT_CPUS, parent: process.env.FORGE_SANDBOX_CGROUP_PARENT };
  try {
    process.env.FORGE_AGENT_MEMORY = "2g"; process.env.FORGE_AGENT_CPUS = "2"; process.env.FORGE_SANDBOX_CGROUP_PARENT = "fletch-builds.slice";
    for (const network of ["none", "default"] as const) {
      const args = sandboxArgs({ image: "fixture", workspace: "/fixture", name: "fixture", network }, ["true"]);
      assert.ok(args.includes("--memory=2147483648")); assert.ok(args.includes("--cpus=2")); assert.ok(args.includes("--cgroup-parent=fletch-builds.slice"));
      assert.ok(args.includes("--read-only")); assert.ok(args.includes("--cap-drop=ALL"));
      assert.deepEqual(args.filter(function coreLimit(arg) { return arg.startsWith("--ulimit=core="); }), ["--ulimit=core=0:0"]);
      assert.ok(args.slice(0, -2).includes("--ulimit=core=0:0"), "Core soft/hard limits belong to Docker, before its image and command");
    }
  } finally {
    for (const [key, value] of Object.entries({ FORGE_AGENT_MEMORY: old.memory, FORGE_AGENT_CPUS: old.cpus, FORGE_SANDBOX_CGROUP_PARENT: old.parent })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("Postgres capacity serializes 100 mixed requests, preserves ownership and fences configuration changes", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function database(t) {
  const connectionString = process.env.FLETCH_TEST_DATABASE_URL;
  const admin = new Pool({ connectionString });
  const namespace = `capacity_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const pool = new Pool({ connectionString, max: 16, options: `-c search_path=${namespace},public` });
  const database = drizzle(pool, { schema });
  const oldExpected = process.env.FORGE_MAX_CONCURRENT_BUILDS;
  delete process.env.FORGE_MAX_CONCURRENT_BUILDS;
  t.after(async function cleanup() {
    if (oldExpected === undefined) delete process.env.FORGE_MAX_CONCURRENT_BUILDS; else process.env.FORGE_MAX_CONCURRENT_BUILDS = oldExpected;
    await pool.end(); await admin.query(`drop schema ${namespace} cascade`); await admin.end();
  });
  await pool.query("create table builds(like public.builds including all)");
  await pool.query("create table app_settings(key text primary key,value text not null,updated_by text,updated_at timestamptz default now())");
  await pool.query("create table audit_log(id text primary key,user_id text,actor_type text,action text,resource_type text,resource_id text,metadata jsonb)");
  await pool.query(await readFile("drizzle/0054_build_worker.sql", "utf8"));
  const pricing = await readFile("drizzle/0057_build_pricing.sql", "utf8");
  await pool.query(pricing.slice(pricing.indexOf("ALTER TABLE build_worker_jobs"), pricing.indexOf("CREATE TABLE IF NOT EXISTS build_pricing_quotes")));

  async function configure(capacity: number, resources = LARGE, profile: CapacityProfile = "conservative"): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const preview = await inspectBuildCapacity(client, resources);
      await setBuildCapacity(client, { capacity, profile, benchmarkReceipt: "c".repeat(64), expectedFingerprint: preview.fingerprint, reviewed: true, reason: "Controlled fixture benchmark" }, { userId: null, name: "fixture-operator" }, resources);
      await client.query("commit");
    } catch (cause) { await client.query("rollback"); throw cause; } finally { client.release(); }
  }
  async function reset(): Promise<void> { await pool.query("truncate builds,build_worker_jobs,build_worker_events,build_worker_effects,app_settings,audit_log"); }
  async function seed(count: number, mixed = false): Promise<void> {
    await pool.query(`insert into builds(id,user_id,project_id,prompt,status,created_at)
      select 'build-'||lpad(i::text,3,'0'),'fixture-owner','project-'||i,'fixture','queued','2020-01-01' from generate_series(0,$1::int-1) i`, [count]);
    await pool.query(`insert into build_worker_jobs(build_id,workspace_key,created_at)
      select id,'project:'||project_id,'2020-01-01' from builds where not $1 or right(id,1) in ('1','3','5','7','9')`, [mixed]);
  }

  await t.test("unset defaults two and an explicit caller cannot override PostgreSQL", async function defaults() {
    await seed(4);
    assert.equal(await readBuildCapacity(pool), 2);
    const claimed = await Promise.all(Array.from({ length: 4 }, (_v, i) => claimWorkerBuild(pool, `worker-${i}`, 30_000, 50, LARGE)));
    assert.equal(claimed.filter(Boolean).length, 2);
    await reset();
  });

  await t.test("50 slots admit exactly 50 of 100 contending requests with deterministic eligible FIFO", async function fifty() {
    await configure(50); await seed(100);
    const claimed = await Promise.all(Array.from({ length: 100 }, (_v, i) => claimWorkerBuild(pool, `worker-${i}`, 30_000, undefined, LARGE)));
    assert.equal(claimed.filter(Boolean).length, 50);
    const ids = claimed.flatMap(value => value ? [value.buildId] : []).sort();
    assert.deepEqual(ids, Array.from({ length: 50 }, (_v, i) => `build-${String(i).padStart(3, "0")}`));
    assert.equal((await readBuildQueue("build-099", database))?.capacity, 50);
    await configure(1);
    assert.equal(await claimWorkerBuild(pool, "lowered", 30_000, 50, LARGE), null);
    assert.equal(Number((await pool.query("select count(*) from builds where status='building'")).rows[0].count), 50);
    await reset();
  });

  await t.test("reviewed shared profile admits exactly 20 of 100 concurrent durable claims and refuses legacy execution", async function sharedRace() {
    await configure(20, SMALL, "shared-experimental"); await seed(100);
    const preview = await inspectBuildCapacity(pool, SMALL);
    assert.equal(preview.eligibleMaximum, 3); assert.equal(preview.sharedEligibleMaximum, 100);
    assert.equal(preview.profile, "shared-experimental"); assert.equal(preview.setting?.version, 2);
    assert.equal(await validatedWorkerCapacity(pool, SMALL), 20);
    const claimed = await Promise.all(Array.from({ length: 100 }, async function contender(_v, i) {
      if (i % 2) {
        assert.equal(await claimNextBuild(database), null, "Legacy claimants cannot bypass shared admission");
        return null;
      }
      return claimWorkerBuild(pool, `shared-${i}`, 30_000, undefined, SMALL,
        async function emptySlice() { return { sliceMemoryBytes: 0, hostAvailableBytes: 6 * GIB }; });
    }));
    assert.equal(claimed.filter(Boolean).length, 20);
    assert.deepEqual(claimed.flatMap(value => value ? [value.buildId] : []).sort(), Array.from({ length: 20 }, (_v, i) => `build-${String(i).padStart(3, "0")}`));
    assert.equal((await readBuildQueue("build-099", database))?.capacity, 20);
    await configure(3, SMALL);
    assert.equal((await inspectBuildCapacity(pool, SMALL)).setting?.version, 1, "Rollback writes the old readable policy shape");
    assert.equal(await claimWorkerBuild(pool, "lowered-shared", 30_000, undefined, SMALL), null);
    assert.equal(Number((await pool.query("select count(*) from builds where status='building'")).rows[0].count), 20);
    await reset(); await configure(20, SMALL, "shared-experimental"); await seed(5, true);
    assert.equal(await claimNextBuild(database), null, "Legacy execution cannot bypass shared worker memory admission");
    assert.equal(Number((await pool.query("select count(*) from builds where status='building'")).rows[0].count), 0);
    await reset();
  });

  await t.test("100 configured slots admit 100 with sufficient memory and throttle this executor at 58", async function hundred() {
    for (const [resources, expected] of [
      [LARGE, 100],
      [{ ...SMALL, logicalCpus: 8, totalMemoryBytes: 31 * GIB, cgroupCpuQuota: 6, cgroupMemoryBytes: 24 * GIB }, 58],
    ] as const) {
      await configure(100, resources, "shared-experimental"); await seed(130);
      assert.equal(await validatedWorkerCapacity(pool, resources), 100);
      const claimed = await Promise.all(Array.from({ length: 130 }, (_v, i) => claimWorkerBuild(pool, `hundred-${i}`, 30_000, undefined, resources,
        async function emptyExecutor() { return { sliceMemoryBytes: 0, hostAvailableBytes: resources.totalMemoryBytes }; })));
      assert.equal(claimed.filter(Boolean).length, expected);
      assert.equal((await readBuildQueue("build-129", database))?.capacity, 100);
      await configure(20, resources, "shared-experimental");
      assert.equal(await claimWorkerBuild(pool, "reduced", 30_000, undefined, resources), null);
      assert.equal(Number((await pool.query("select count(*) from build_worker_jobs where state='running'")).rows[0].count), expected);
      await reset();
    }
  });

  await t.test("memory pressure and missing observations leave source ownership and queue untouched", async function pressure() {
    await configure(20, SMALL, "shared-experimental"); await seed(5);
    const live = await claimWorkerBuild(pool, "live", 30_000, undefined, SMALL, async () => ({ sliceMemoryBytes: 0, hostAvailableBytes: 6 * GIB }));
    assert.ok(live);
    const before = (await pool.query("select * from build_worker_jobs order by build_id")).rows;
    for (const read of [
      async () => ({ sliceMemoryBytes: 8 * GIB, hostAvailableBytes: 6 * GIB }),
      async () => ({ sliceMemoryBytes: 0, hostAvailableBytes: 4 * GIB - 1 }),
      async () => ({ sliceMemoryBytes: NaN, hostAvailableBytes: 6 * GIB }),
      async () => { throw new Error("Missing cgroup observation"); },
    ]) assert.equal(await claimWorkerBuild(pool, "denied", 30_000, undefined, SMALL, read), null);
    assert.deepEqual((await pool.query("select * from build_worker_jobs order by build_id")).rows, before);
    assert.equal(Number((await pool.query("select count(*) from builds where status='building'")).rows[0].count), 1);
    const resumed = await claimWorkerBuild(pool, "room-returned", 30_000, undefined, SMALL, async () => ({ sliceMemoryBytes: 0, hostAvailableBytes: 6 * GIB }));
    assert.equal(resumed?.buildId, "build-001");
    await reset();
  });

  await t.test("shared policy requires its benchmark, measured host, and fresh review even at capacity two", async function sharedGuards() {
    const client = await pool.connect();
    try {
      for (const request of [
        { capacity: 20, profile: "shared-experimental" as const, reviewed: true },
        { capacity: 20, profile: "shared-experimental" as const, reviewed: false, benchmarkReceipt: "c".repeat(64) },
        { capacity: 101, profile: "shared-experimental" as const, reviewed: true, benchmarkReceipt: "c".repeat(64) },
      ]) {
        await client.query("begin");
        const preview = await inspectBuildCapacity(client, SMALL);
        await assert.rejects(setBuildCapacity(client, { ...request, expectedFingerprint: preview.fingerprint, reason: "Fixture guard" }, { userId: null, name: "fixture" }, SMALL));
        await client.query("rollback");
      }
    } finally { client.release(); }
    assert.equal(await readBuildCapacity(pool), 2);
    await configure(2, SMALL, "shared-experimental");
    await assert.rejects(validatedWorkerCapacity(pool, { ...SMALL, cgroupParent: null, cgroupCpuQuota: null, cgroupMemoryBytes: null }), /fresh review/);
    await assert.rejects(validatedWorkerCapacity(pool, { ...SMALL, sandboxCpus: 1.5 }), /fresh review/);
    await assert.rejects(validatedWorkerCapacity(pool, { ...SMALL, hostId: "d".repeat(64) }), /another host/);
    const policy = (await inspectBuildCapacity(pool, SMALL)).setting!;
    for (const malformed of [{ ...policy, capacity: 101 }, { ...policy, benchmarkReceipt: "" }, { ...policy, profile: "unlimited" }]) assert.throws(() => parseCapacitySetting(malformed));
    await reset();
  });

  await t.test("legacy and durable claimants share the limit and paused projects stay exclusive", async function mixed() {
    await configure(50); await seed(100, true);
    await pool.query("update builds set project_id='project-1' where id='build-003';update build_worker_jobs set workspace_key='project:project-1' where build_id='build-003'");
    const attempts = Array.from({ length: 100 }, (_v, i) => i % 2 ? claimNextBuild(database) : claimWorkerBuild(pool, `mixed-${i}`, 30_000, 50, LARGE));
    await Promise.all(attempts);
    const active = Number((await pool.query("select count(*) from builds where status='building'")).rows[0].count);
    assert.ok(active <= 50); assert.ok(active >= 48);
    assert.equal(Number((await pool.query("select count(*) from builds where project_id='project-1' and status='building'")).rows[0].count), 1);
    await pool.query("update build_worker_jobs set state='paused_budget' where build_id='build-001';update builds set status='paused' where id='build-001'");
    assert.equal(await claimWorkerBuild(pool, "same-project", 30_000, 50, LARGE), null);
    await reset();
  });

  await t.test("malformed, different-host and stale resource settings never grant a claim", async function guards() {
    await seed(2); await configure(3, SMALL);
    await assert.rejects(validatedWorkerCapacity(pool, { ...SMALL, hostId: "b".repeat(64) }), /another host/);
    await assert.rejects(validatedWorkerCapacity(pool, { ...SMALL, cgroupCpuQuota: 2 }), /aggregate sandbox limits|fresh review/);
    process.env.FORGE_MAX_CONCURRENT_BUILDS = "50";
    await assert.rejects(claimWorkerBuild(pool, "mismatch", 30_000, undefined, SMALL), /environment differs/);
    delete process.env.FORGE_MAX_CONCURRENT_BUILDS;
    await pool.query("update app_settings set value='malformed' where key=$1", [BUILD_CAPACITY_KEY]);
    await assert.rejects(claimWorkerBuild(pool, "malformed", 30_000, undefined, SMALL), /malformed/);
    assert.equal(Number((await pool.query("select count(*) from builds where status='building'")).rows[0].count), 0);
    await reset();
  });

  await t.test("stale previews cannot overwrite another operator and audit failure rolls back policy", async function consent() {
    const preview = await inspectBuildCapacity(pool, SMALL);
    await configure(3, SMALL);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await assert.rejects(setBuildCapacity(client, { capacity: 2, expectedFingerprint: preview.fingerprint, reviewed: true, reason: "Stale fixture preview" }, { userId: null, name: "fixture" }, SMALL), /changed after/);
      await client.query("rollback");
      await client.query("begin");
      const next = await inspectBuildCapacity(client, SMALL);
      await client.query("alter table audit_log add constraint reject_audit check(false) not valid");
      await assert.rejects(setBuildCapacity(client, { capacity: 2, expectedFingerprint: next.fingerprint, reviewed: true, reason: "Atomic fixture change" }, { userId: null, name: "fixture" }, SMALL), /reject_audit/);
      await client.query("rollback");
      assert.equal(await readBuildCapacity(pool), 3);
      assert.equal(Number((await pool.query("select count(*) from audit_log")).rows[0].count), 1);
    } finally { client.release(); }
  });
});
