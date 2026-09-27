import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import { builds, user } from "./schema";
import type { BuildAllowance, PricingSnapshot } from "@/lib/build/pricing-policy";

export const buildPricingQuotes = pgTable("build_pricing_quotes", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  projectId: text("project_id"),
  buildId: text("build_id").references(() => builds.id, { onDelete: "restrict" }),
  fingerprint: text("fingerprint").notNull(), digest: text("digest").notNull(), snapshot: jsonb("snapshot").$type<PricingSnapshot>().notNull(),
  priorAuthorizationId: text("prior_authorization_id"), issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedBuildId: text("accepted_build_id").references(() => builds.id, { onDelete: "restrict" }), acceptedAt: timestamp("accepted_at", { withTimezone: true }),
}, function indexes(table) { return [index("build_pricing_quotes_owner_recent_idx").on(table.userId, table.issuedAt)]; });
export const buildBudgetAuthorizations = pgTable("build_budget_authorizations", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  buildId: text("build_id").notNull().references(() => builds.id, { onDelete: "restrict" }),
  quoteId: text("quote_id").notNull().unique().references(() => buildPricingQuotes.id, { onDelete: "restrict" }),
  priorAuthorizationId: text("prior_authorization_id"), packages: integer("packages").notNull(),
  incrementalCredits: integer("incremental_credits").notNull(), cumulativeCredits: integer("cumulative_credits").notNull(),
  allowance: jsonb("allowance").$type<BuildAllowance>().notNull(), clientRequestId: text("client_request_id").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, function constraints(table) { return [
  foreignKey({ columns: [table.priorAuthorizationId], foreignColumns: [table.id] }).onDelete("restrict"),
  unique().on(table.userId, table.clientRequestId), unique().on(table.buildId, table.packages),
  check("build_budget_authorizations_packages_check", sql`${table.packages} between 1 and 10`),
  check("build_budget_authorizations_incremental_credits_check", sql`${table.incrementalCredits} between 0 and 10000`),
  check("build_budget_authorizations_check", sql`${table.cumulativeCredits} between 0 and 10000 and ${table.cumulativeCredits}>=${table.incrementalCredits}`),
]; });
export const buildBudgetUsage = pgTable("build_budget_usage", {
  buildId: text("build_id").notNull().references(() => builds.id, { onDelete: "restrict" }), effectKey: text("effect_key").notNull(),
  kind: text("kind").$type<"model_request" | "tool_run" | "active_time">().notNull(), units: integer("units").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, function constraints(table) { return [primaryKey({ columns: [table.buildId, table.effectKey, table.kind] }),
  check("build_budget_usage_kind_check", sql`${table.kind} in ('model_request','tool_run','active_time')`), check("build_budget_usage_units_check", sql`${table.units}>=0`)]; });
export const buildPricingSettlements = pgTable("build_pricing_settlements", {
  buildId: text("build_id").primaryKey().references(() => builds.id, { onDelete: "restrict" }),
  outcome: text("outcome").$type<"succeeded" | "failed" | "stopped">().notNull(),
  chargedCredits: integer("charged_credits").notNull(), releasedCredits: integer("released_credits").notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, function constraints(table) { return [
  check("build_pricing_settlements_outcome_check", sql`${table.outcome} in ('succeeded','failed','stopped')`),
  check("build_pricing_settlements_charged_credits_check", sql`${table.chargedCredits}>=0`), check("build_pricing_settlements_released_credits_check", sql`${table.releasedCredits}>=0`),
]; });
