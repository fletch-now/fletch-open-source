import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cpus, hostname, platform, totalmem } from "node:os";
import type { Pool, PoolClient } from "pg";
import { executorAlias, readExecutorSnapshot } from "./executor";

export const BUILD_CAPACITY_KEY = "build.capacity";
export const BUILD_CLAIM_LOCK = 73462019;
export const MAX_BUILD_CAPACITY = 100;
const exec = promisify(execFile);
const GIB = 1024 ** 3;
const SHARED_MEMORY_RESERVE = 4 * GIB;
const WORKER_MEMORY_PER_BUILD = GIB / 4;

export interface SandboxLimits {
  memoryBytes: number;
  cpus: number;
  cgroupParent: string | null;
}

export interface CapacityResources {
  hostId: string;
  platform: string;
  workerExecution: boolean;
  sandboxEnabled: boolean;
  logicalCpus: number;
  totalMemoryBytes: number;
  sandboxMemoryBytes: number;
  sandboxCpus: number;
  cgroupParent: string | null;
  cgroupDriver: string | null;
  cgroupCpuQuota: number | null;
  cgroupMemoryBytes: number | null;
}

export type CapacityProfile = "conservative" | "shared-experimental";
export const SHARED_BUILD_ADMISSION = Object.freeze({
  reservationBytes: 384 * 1024 ** 2,
  watermarkBytes: 8 * GIB,
  hostAvailableFloorBytes: 4 * GIB,
});

interface CapacitySettingBase {
  capacity: number;
  hostId: string;
  resourceFingerprint: string;
  reviewedAt: string;
}

export type BuildCapacitySetting = CapacitySettingBase & (
  { version: 1 } |
  { version: 2; profile: "shared-experimental"; benchmarkReceipt: string }
);

export interface CapacityPressure {
  sliceMemoryBytes: number;
  hostAvailableBytes: number;
}

export type CapacityPressureReader = (resources: CapacityResources) => Promise<CapacityPressure>;

export interface BuildCapacityInspection {
  current: number;
  profile: CapacityProfile;
  sharedEligibleMaximum: number;
  sharedReasons: string[];
  sharedAdmission: typeof SHARED_BUILD_ADMISSION;
  setting: BuildCapacitySetting | null;
  resources: CapacityResources;
  eligibleMaximum: number;
  reasons: string[];
  fingerprint: string;
}

export function parseCapacity(value: unknown): number {
  if (typeof value === "string" && !/^[1-9]\d*$/.test(value)) throw new Error("Build capacity must be an integer from 1 to 100.");
  const capacity = typeof value === "string" ? Number(value) : value;
  if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity < 1 || capacity > MAX_BUILD_CAPACITY) {
    throw new Error("Build capacity must be an integer from 1 to 100.");
  }
  return capacity;
}

export function sandboxLimits(env: Record<string, string | undefined> = process.env): SandboxLimits {
  const memory = env.FORGE_AGENT_MEMORY ?? "2g";
  const match = /^([1-9]\d*)([bkmg])?$/i.exec(memory);
  if (!match) throw new Error("FORGE_AGENT_MEMORY must be a positive Docker byte, k, m or g limit.");
  const multiplier = { b: 1, k: 1024, m: 1024 ** 2, g: GIB }[match[2]?.toLowerCase() ?? "b"]!;
  const memoryBytes = Number(match[1]) * multiplier;
  if (!Number.isSafeInteger(memoryBytes) || memoryBytes < 6 * 1024 ** 2) throw new Error("Sandbox memory must be at least 6 MiB and a safe integer.");
  const cpuText = env.FORGE_AGENT_CPUS ?? "1.5";
  const cpuLimit = Number(cpuText);
  if (!/^\d+(?:\.\d+)?$/.test(cpuText) || !Number.isFinite(cpuLimit) || cpuLimit <= 0 || cpuLimit > 1024) {
    throw new Error("FORGE_AGENT_CPUS must be a positive CPU limit.");
  }
  const cgroupParent = env.FORGE_SANDBOX_CGROUP_PARENT ?? null;
  if (cgroupParent !== null && (!/^fletch-[a-z0-9]+(?:-[a-z0-9]+)*\.slice$/.test(cgroupParent) || cgroupParent.length > 100)) {
    throw new Error("FORGE_SANDBOX_CGROUP_PARENT must name a managed fletch-*.slice.");
  }
  return { memoryBytes, cpus: cpuLimit, cgroupParent };
}

function slicePath(name: string): string {
  const parts = name.slice(0, -6).split("-");
  return "/sys/fs/cgroup/" + parts.map((_part, index) => parts.slice(0, index + 1).join("-") + ".slice").join("/");
}

export async function readCapacityResources(env: Record<string, string | undefined> = process.env): Promise<CapacityResources> {
  const limits = sandboxLimits(env);
  if (executorAlias(env)) {
    const remote = await readExecutorSnapshot(env);
    if (limits.cgroupParent !== remote.cgroupParent) throw new Error("Remote sandbox limits must use the inspected executor slice.");
    return { hostId: remote.hostId, platform: remote.platform, workerExecution: env.FORGE_BUILD_EXECUTION === "worker",
      sandboxEnabled: env.FORGE_AGENT_SANDBOX === "docker" && Boolean(env.FORGE_AGENT_IMAGE), logicalCpus: remote.logicalCpus,
      totalMemoryBytes: remote.totalMemoryBytes, sandboxMemoryBytes: limits.memoryBytes, sandboxCpus: limits.cpus,
      cgroupParent: remote.cgroupParent, cgroupDriver: remote.cgroupDriver, cgroupCpuQuota: remote.cgroupCpuQuota,
      cgroupMemoryBytes: remote.cgroupMemoryBytes };
  }
  const machine = await readFile("/etc/machine-id", "utf8").catch(() => hostname());
  const result: CapacityResources = {
    hostId: createHash("sha256").update(machine.trim()).digest("hex"), platform: platform(),
    workerExecution: env.FORGE_BUILD_EXECUTION === "worker", sandboxEnabled: env.FORGE_AGENT_SANDBOX === "docker" && Boolean(env.FORGE_AGENT_IMAGE),
    logicalCpus: cpus().length, totalMemoryBytes: totalmem(), sandboxMemoryBytes: limits.memoryBytes,
    sandboxCpus: limits.cpus, cgroupParent: limits.cgroupParent, cgroupDriver: null, cgroupCpuQuota: null, cgroupMemoryBytes: null,
  };
  if (limits.cgroupParent) {
    const path = slicePath(limits.cgroupParent);
    const [cpu, memory, driver] = await Promise.all([
      readFile(path + "/cpu.max", "utf8").catch(() => ""),
      readFile(path + "/memory.max", "utf8").catch(() => ""),
      exec("docker", ["info", "--format", "{{.CgroupDriver}}"], { timeout: 5_000, maxBuffer: 1024 }).then(result => result.stdout.trim()).catch(() => ""),
    ]);
    result.cgroupDriver = driver || null;
    const quota = /^(\d+)\s+(\d+)$/.exec(cpu.trim());
    if (quota && Number(quota[1]) > 0 && Number(quota[2]) > 0) result.cgroupCpuQuota = Number(quota[1]) / Number(quota[2]);
    if (/^[1-9]\d*$/.test(memory.trim()) && Number.isSafeInteger(Number(memory.trim()))) result.cgroupMemoryBytes = Number(memory.trim());
  }
  return result;
}

export function parseCapacitySetting(value: unknown): BuildCapacitySetting | null {
  if (value === null || value === undefined) return null;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { throw new Error("Stored build capacity is malformed."); }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Stored build capacity is malformed.");
  const row = parsed as Record<string, unknown>;
  if ((row.version !== 1 && row.version !== 2) || typeof row.hostId !== "string" || !/^[a-f0-9]{64}$/.test(row.hostId)
    || typeof row.resourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(row.resourceFingerprint)
    || typeof row.reviewedAt !== "string" || !Number.isFinite(Date.parse(row.reviewedAt))) throw new Error("Stored build capacity is malformed.");
  const base = { capacity: parseCapacity(row.capacity), hostId: row.hostId, resourceFingerprint: row.resourceFingerprint, reviewedAt: row.reviewedAt };
  if (row.version === 1) return { version: 1, ...base };
  if (row.profile !== "shared-experimental" || typeof row.benchmarkReceipt !== "string"
    || !/^[a-f0-9]{64}$/.test(row.benchmarkReceipt)) throw new Error("Stored shared build capacity is malformed.");
  return { version: 2, profile: "shared-experimental", benchmarkReceipt: row.benchmarkReceipt, ...base };
}

export function inspectCapacityResources(resources: CapacityResources): Pick<BuildCapacityInspection, "eligibleMaximum" | "reasons" | "fingerprint"> {
  const fingerprint = createHash("sha256").update(JSON.stringify(resources)).digest("hex");
  const reasons: string[] = [];
  const positive = [resources.logicalCpus, resources.totalMemoryBytes, resources.sandboxMemoryBytes, resources.sandboxCpus];
  if (positive.some(value => !Number.isFinite(value) || value <= 0) || !Number.isInteger(resources.logicalCpus)
    || resources.cgroupCpuQuota !== null && (!Number.isFinite(resources.cgroupCpuQuota) || resources.cgroupCpuQuota <= 0)
    || resources.cgroupMemoryBytes !== null && (!Number.isSafeInteger(resources.cgroupMemoryBytes) || resources.cgroupMemoryBytes <= 0)) {
    return { eligibleMaximum: 0, reasons: ["Host or sandbox resource observations are invalid."], fingerprint };
  }
  if (!resources.workerExecution || !resources.sandboxEnabled) {
    return { eligibleMaximum: 2, reasons: ["More than two builds requires independent worker routing and Docker sandboxing."], fingerprint };
  }
  if (resources.platform !== "linux" || resources.cgroupDriver !== "systemd" || !resources.cgroupParent || !resources.cgroupCpuQuota || !resources.cgroupMemoryBytes) {
    reasons.push("More than two builds requires Docker systemd cgroups and a managed Linux build slice with finite CPU and memory limits.");
    return { eligibleMaximum: 2, reasons, fingerprint };
  }
  const cpuReserve = Math.max(1, resources.logicalCpus / 4);
  if (resources.cgroupCpuQuota > resources.logicalCpus - cpuReserve) reasons.push("The build slice must leave at least one CPU or 25% of host CPUs for shared services.");
  const memoryRoom = resources.totalMemoryBytes - resources.cgroupMemoryBytes - SHARED_MEMORY_RESERVE;
  if (memoryRoom < 0) reasons.push("The build slice must leave at least 4 GiB for shared services.");
  const limit = Math.min(50,
    Math.floor(resources.cgroupCpuQuota * 2 / resources.sandboxCpus),
    Math.floor(resources.cgroupMemoryBytes / resources.sandboxMemoryBytes),
    Math.floor(memoryRoom / WORKER_MEMORY_PER_BUILD));
  const eligibleMaximum = reasons.length ? 0 : Math.max(0, limit);
  if (limit < 3) reasons.push("The slice cannot fit three sandbox limits plus bounded worker headroom.");
  return { eligibleMaximum, reasons, fingerprint };
}

export function inspectSharedCapacityResources(resources: CapacityResources): { sharedEligibleMaximum: number; sharedReasons: string[] } {
  const baseline = inspectCapacityResources(resources);
  const sharedReasons = baseline.eligibleMaximum < 3 ? [...baseline.reasons] : [];
  if (resources.logicalCpus < 4 || (resources.cgroupCpuQuota ?? 0) < 3) sharedReasons.push("Shared experimental admission needs at least four host CPUs and a three-CPU build slice.");
  if ((resources.cgroupMemoryBytes ?? 0) < SHARED_BUILD_ADMISSION.watermarkBytes + 2 * GIB) {
    sharedReasons.push("Shared experimental admission needs at least 10 GiB in the build slice, including 2 GiB above its admission watermark.");
  }
  if (baseline.eligibleMaximum < 3 && !sharedReasons.length) sharedReasons.push("The host does not meet the conservative three-build baseline.");
  return { sharedEligibleMaximum: sharedReasons.length ? 0 : MAX_BUILD_CAPACITY, sharedReasons };
}

export function sharedAdmissionForResources(resources: CapacityResources): typeof SHARED_BUILD_ADMISSION {
  const bytes = resources.cgroupMemoryBytes;
  const watermarkBytes = bytes !== null && Number.isSafeInteger(bytes) && bytes > 2 * GIB ? bytes - 2 * GIB : 0;
  return { ...SHARED_BUILD_ADMISSION, watermarkBytes };
}

export function parseCapacityPressure(memoryCurrent: string, meminfo: string): CapacityPressure {
  const current = memoryCurrent.trim();
  const available = /^MemAvailable:\s+([0-9]+) kB\s*$/m.exec(meminfo);
  if (!/^(0|[1-9]\d*)$/.test(current) || !available) throw new Error("Build memory observations are unavailable.");
  const pressure = { sliceMemoryBytes: Number(current), hostAvailableBytes: Number(available[1]) * 1024 };
  if ([pressure.sliceMemoryBytes, pressure.hostAvailableBytes].some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("Build memory observations are invalid.");
  return pressure;
}

export async function readCapacityPressure(resources: CapacityResources): Promise<CapacityPressure> {
  if (!resources.cgroupParent) throw new Error("Build memory admission requires a managed slice.");
  if (executorAlias()) {
    const remote = await readExecutorSnapshot();
    if (remote.hostId !== resources.hostId) throw new Error("Executor identity changed during admission.");
    return { sliceMemoryBytes: remote.sliceMemoryBytes, hostAvailableBytes: remote.hostAvailableBytes };
  }
  const [current, meminfo] = await Promise.all([
    readFile(slicePath(resources.cgroupParent) + "/memory.current", "utf8"),
    readFile("/proc/meminfo", "utf8"),
  ]);
  return parseCapacityPressure(current, meminfo);
}

export function hasSharedMemoryRoom(activeCount: number, pressure: CapacityPressure, admission = SHARED_BUILD_ADMISSION): boolean {
  if (!Number.isSafeInteger(activeCount) || activeCount < 0
    || [pressure.sliceMemoryBytes, pressure.hostAvailableBytes].some(value => !Number.isSafeInteger(value) || value < 0)) return false;
  // A new claim reserves memory before Docker starts, so racing admissions cannot
  // all observe the same empty slice. This is a waiting-session allowance, not a
  // guarantee against later simultaneous compiler bursts from admitted sessions.
  const projected = Math.max(pressure.sliceMemoryBytes, activeCount * admission.reservationBytes)
    + admission.reservationBytes;
  return projected <= admission.watermarkBytes
    && pressure.hostAvailableBytes >= admission.hostAvailableFloorBytes;
}

type CapacityDatabase = Pool | PoolClient;

async function defaultDatabase(): Promise<Pool> {
  return (await import("@/lib/db")).pool;
}

export async function readCapacitySetting(client?: CapacityDatabase): Promise<BuildCapacitySetting | null> {
  const database = client ?? await defaultDatabase();
  const result = await database.query("select value from app_settings where key=$1", [BUILD_CAPACITY_KEY]);
  return parseCapacitySetting(result.rows[0]?.value);
}

export async function readBuildCapacity(client?: CapacityDatabase): Promise<number> {
  return (await readCapacitySetting(client))?.capacity ?? 2;
}

export async function inspectBuildCapacity(client?: CapacityDatabase, resources?: CapacityResources): Promise<BuildCapacityInspection> {
  const setting = await readCapacitySetting(client);
  const observed = resources ?? await readCapacityResources();
  const eligibility = inspectCapacityResources(observed);
  const fingerprint = createHash("sha256").update(JSON.stringify({ resources: eligibility.fingerprint, setting })).digest("hex");
  return { current: setting?.capacity ?? 2, profile: setting?.version === 2 ? setting.profile : "conservative",
    setting, resources: observed, ...eligibility, ...inspectSharedCapacityResources(observed), sharedAdmission: sharedAdmissionForResources(observed), fingerprint };
}

export async function validatedWorkerCapacity(client: CapacityDatabase, resources?: CapacityResources): Promise<number> {
  const inspection = await inspectBuildCapacity(client, resources);
  return validateWorkerInspection(inspection);
}

function validateWorkerInspection(inspection: BuildCapacityInspection): number {
  const maximum = inspection.profile === "shared-experimental" ? inspection.sharedEligibleMaximum : inspection.eligibleMaximum;
  const expected = process.env.FORGE_MAX_CONCURRENT_BUILDS;
  if (expected !== undefined && parseCapacity(expected) > inspection.current) throw new Error("Worker capacity environment differs from the shared build capacity setting.");
  if (inspection.resources.cgroupParent && (inspection.resources.cgroupDriver !== "systemd"
    || !inspection.resources.cgroupCpuQuota || !inspection.resources.cgroupMemoryBytes || inspection.current > maximum)) {
    throw new Error("Configured aggregate sandbox limits cannot safely fit the approved build capacity.");
  }
  if (inspection.setting && inspection.setting.hostId !== inspection.resources.hostId) throw new Error("Build capacity belongs to another host; local source recovery is not a fleet protocol.");
  if ((inspection.current > 2 || inspection.profile === "shared-experimental") && (inspection.current > maximum || inspection.setting?.resourceFingerprint !== inspectCapacityResources(inspection.resources).fingerprint)) {
    throw new Error("Elevated build capacity requires a fresh review of this host and its aggregate sandbox limits.");
  }
  return Math.min(inspection.current, expected === undefined ? inspection.current : parseCapacity(expected));
}

// Caller holds BUILD_CLAIM_LOCK through the subsequent claim update.
export async function canAdmitWorkerBuild(client: CapacityDatabase, activeCount: number, resources?: CapacityResources, pressureReader: CapacityPressureReader = readCapacityPressure): Promise<boolean> {
  const inspection = await inspectBuildCapacity(client, resources);
  const capacity = validateWorkerInspection(inspection);
  if (activeCount >= capacity) return false;
  if (inspection.profile === "conservative") return true;
  try {
    return hasSharedMemoryRoom(activeCount, await pressureReader(inspection.resources), inspection.sharedAdmission);
  } catch {
    // Losing an observation queues work; it never removes an existing owner.
    return false;
  }
}

// Caller holds a transaction so configuration and its audit either both commit or neither does.
export async function setBuildCapacity(client: PoolClient, request: { capacity: number; expectedFingerprint: string; reviewed: boolean; reason: string; profile?: CapacityProfile; benchmarkReceipt?: string }, actor: { userId: string | null; name: string }, resources?: CapacityResources): Promise<BuildCapacityInspection> {
  const capacity = parseCapacity(request.capacity);
  const profile = request.profile ?? "conservative";
  if (profile !== "conservative" && profile !== "shared-experimental") throw new Error("Unknown build capacity profile.");
  if (profile === "shared-experimental" && (!request.reviewed || !/^[a-f0-9]{64}$/.test(request.benchmarkReceipt ?? ""))) {
    throw new Error("Shared experimental capacity requires explicit review and a SHA-256 benchmark receipt.");
  }
  const reason = request.reason.trim();
  if (reason.length < 4 || reason.length > 200) throw new Error("Capacity change reason must contain 4 to 200 characters.");
  if (!actor.name.trim()) throw new Error("Capacity changes require an identified operator.");
  await client.query("select pg_advisory_xact_lock($1)", [BUILD_CLAIM_LOCK]);
  const before = await inspectBuildCapacity(client, resources);
  if (request.expectedFingerprint !== before.fingerprint) throw new Error("Host resources changed after the capacity preview.");
  const maximum = profile === "shared-experimental" ? before.sharedEligibleMaximum : before.eligibleMaximum;
  if (profile === "shared-experimental" && capacity > maximum) throw new Error("Shared experimental capacity exceeds this host's eligible ceiling.");
  if (capacity > 2 && (!request.reviewed || capacity > maximum)) throw new Error("Elevated capacity needs reviewed resource eligibility and a completed load benchmark.");
  const base: CapacitySettingBase = { capacity, hostId: before.resources.hostId,
    resourceFingerprint: inspectCapacityResources(before.resources).fingerprint, reviewedAt: new Date().toISOString() };
  let setting: BuildCapacitySetting = { version: 1, ...base };
  if (profile === "shared-experimental") setting = { version: 2, profile, benchmarkReceipt: request.benchmarkReceipt!, ...base };
  await client.query(`insert into app_settings(key,value,updated_by) values($1,$2,$3)
    on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=clock_timestamp()`, [BUILD_CAPACITY_KEY, JSON.stringify(setting), actor.name]);
  await client.query(`insert into audit_log(id,user_id,actor_type,action,resource_type,resource_id,metadata)
    values($1,$2,'user','admin.build.capacity','setting',$3,$4)`, [`al_${randomUUID()}`, actor.userId, BUILD_CAPACITY_KEY, JSON.stringify({ previous: before.setting, next: setting, resources: before.resources, reviewed: request.reviewed, reason, operator: actor.name })]);
  return inspectBuildCapacity(client, before.resources);
}
