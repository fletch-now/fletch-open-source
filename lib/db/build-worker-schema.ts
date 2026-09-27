import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { builds } from "@/lib/db/schema";
import type { EffectKind, Receipt, WorkerState } from "@/lib/build/durable/ownership";

export const buildWorkerJobs = pgTable("build_worker_jobs", {
  buildId: text("build_id").primaryKey(),
  workspaceKey: text("workspace_key").notNull(),
  state: text("state").$type<WorkerState>().notNull().default("queued"),
  attempt: integer("attempt").notNull().default(0),
  ownerId: text("owner_id"),
  fence: text("fence"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  stopRequestedAt: timestamp("stop_requested_at", { withTimezone: true }),
  lastSeq: integer("last_seq").notNull().default(0),
  checkpointHash: text("checkpoint_hash"),
  recoveryReason: text("recovery_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, function constraints(table) {
  return [
    foreignKey({ name: "build_worker_jobs_build_id_fkey", columns: [table.buildId], foreignColumns: [builds.id] }).onDelete("restrict"),
    check("build_worker_jobs_state_check", sql`${table.state} in ('queued','running','recovery_required','paused_budget','completed','stopped')`),
    check("build_worker_jobs_attempt_check", sql`${table.attempt} >= 0`),
    check("build_worker_jobs_last_seq_check", sql`${table.lastSeq} >= 0`),
    check("build_worker_jobs_check", sql`${table.state} <> 'running' or (${table.ownerId} is not null and ${table.fence} is not null and ${table.leaseExpiresAt} is not null)`),
    uniqueIndex("build_worker_workspace_owner_idx").on(table.workspaceKey).where(sql`${table.state} in ('running','recovery_required','paused_budget')`),
    index("build_worker_queue_idx").on(table.state, table.createdAt, table.buildId),
  ];
});

export const buildWorkerEvents = pgTable("build_worker_events", {
  buildId: text("build_id").notNull(),
  seq: integer("seq").notNull(),
  attempt: integer("attempt").notNull(),
  kind: text("kind").notNull(),
  detail: jsonb("detail").$type<Receipt>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, function constraints(table) {
  return [
    primaryKey({ name: "build_worker_events_pkey", columns: [table.buildId, table.seq] }),
    foreignKey({ name: "build_worker_events_build_id_fkey", columns: [table.buildId], foreignColumns: [buildWorkerJobs.buildId] }).onDelete("restrict"),
  ];
});

export const buildWorkerEffects = pgTable("build_worker_effects", {
  buildId: text("build_id").notNull(),
  effectKey: text("effect_key").notNull(),
  attempt: integer("attempt").notNull(),
  kind: text("kind").$type<EffectKind>().notNull(),
  checkpointHash: text("checkpoint_hash").notNull(),
  state: text("state").$type<"uncertain" | "completed">().notNull().default("uncertain"),
  receipt: jsonb("receipt").$type<Receipt>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, function constraints(table) {
  return [
    primaryKey({ name: "build_worker_effects_pkey", columns: [table.buildId, table.effectKey] }),
    foreignKey({ name: "build_worker_effects_build_id_fkey", columns: [table.buildId], foreignColumns: [buildWorkerJobs.buildId] }).onDelete("restrict"),
    check("build_worker_effects_kind_check", sql`${table.kind} in ('model','tool','deployment','publication')`),
    check("build_worker_effects_state_check", sql`${table.state} in ('uncertain','completed')`),
  ];
});
