import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const registryPriorityTokens = pgTable("registry_priority_tokens", {
  chainId: integer("chain_id").notNull(), address: text("address").notNull(), assetId: text("asset_id"),
  role: text("role").notNull(), groupKey: text("group_key").notNull(), dominantAddress: text("dominant_address"),
  selectionReason: text("selection_reason").notNull(), closeCall: boolean("close_call").notNull().default(false),
  rank: integer("rank").notNull(), selectedAt: timestamp("selected_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ name: "registry_priority_tokens_pkey", columns: [table.chainId, table.address] }),
  index("registry_priority_tokens_display_idx").on(table.chainId, table.role, table.rank),
  index("registry_priority_tokens_group_idx").on(table.chainId, table.groupKey),
  check("registry_priority_tokens_role_check", sql`${table.role} in ('listed','community','alternative')`),
  check("registry_priority_tokens_rank_check", sql`${table.rank} >= 0`),
  check("registry_priority_tokens_address_check", sql`${table.address} ~ '^0x[0-9a-f]{40}$'`),
  check("registry_priority_tokens_dominant_address_check", sql`${table.dominantAddress} is null or ${table.dominantAddress} ~ '^0x[0-9a-f]{40}$'`),
]);

export const registryPriorityPools = pgTable("registry_priority_pools", {
  chainId: integer("chain_id").notNull(), poolId: text("pool_id").notNull(), address: text("address").notNull(),
  selected: boolean("selected").notNull().default(false), selectedAt: timestamp("selected_at", { withTimezone: true }),
  method: text("method").notNull(), depthUsd: numeric("depth_usd"), priceUsd: numeric("price_usd"),
  source: text("source").notNull(), reason: text("reason"), observedAt: timestamp("observed_at", { withTimezone: true }),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(), blockNumber: bigint("block_number", { mode: "bigint" }),
  blockHash: text("block_hash"), factoryCreatedBlock: bigint("factory_created_block", { mode: "bigint" }).notNull(), factoryCreatedHash: text("factory_created_hash"), quotePriceSource: text("quote_price_source"), quoteObservation: jsonb("quote_observation"),
}, (table) => [
  primaryKey({ name: "registry_priority_pools_pkey", columns: [table.chainId, table.poolId] }),
  index("registry_priority_pools_selected_idx").on(table.chainId, table.selected, table.address),
  check("registry_priority_pools_quote_observation_check", sql`${table.quoteObservation} is null or jsonb_typeof(${table.quoteObservation})='object'`),
  check("registry_priority_pools_method_check", sql`${table.method} in ('v3_quote_holdings','v4_bounded_one_percent')`),
  check("registry_priority_pools_depth_usd_check", sql`${table.depthUsd} >= 0`),
  check("registry_priority_pools_price_usd_check", sql`${table.priceUsd} >= 0`),
  check("registry_priority_pools_address_check", sql`${table.address} ~ '^0x[0-9a-f]{40}$'`),
]);

export const registryTokenObservations = pgTable("registry_token_observations", {
  chainId: integer("chain_id").notNull(), address: text("address").notNull(), metadata: jsonb("metadata"), holders: jsonb("holders"), holderScan: jsonb("holder_scan"),
  metadataAttemptedAt: timestamp("metadata_attempted_at", { withTimezone: true }), holdersAttemptedAt: timestamp("holders_attempted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ name: "registry_token_observations_pkey", columns: [table.chainId, table.address] }),
  check("registry_token_observations_address_check", sql`${table.address} ~ '^0x[0-9a-f]{40}$'`),
  check("registry_token_observations_metadata_check", sql`${table.metadata} is null or jsonb_typeof(${table.metadata})='object'`),
  check("registry_token_observations_holders_check", sql`${table.holders} is null or jsonb_typeof(${table.holders})='object'`),
  check("registry_token_observations_holder_scan_check", sql`${table.holderScan} is null or jsonb_typeof(${table.holderScan})='object'`),
]);
