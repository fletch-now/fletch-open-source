import {
  bigint,
  boolean,
  check,
  index,
  primaryKey,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { DeliveryChannel } from "@/lib/watch/types";
import type { BuildAttachment } from "@/lib/build/types";

// ── better-auth core tables (field names must match better-auth exactly) ──

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // admin plugin fields
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  issuer: text("issuer"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// SIWE plugin table
export const walletAddress = pgTable("wallet_address", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  address: text("address").notNull(),
  chainId: integer("chain_id").notNull(),
  isPrimary: boolean("is_primary").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Fletch application tables (see BACKEND_PLAN.md §8) ──

export const buildStatus = pgEnum("build_status", [
  "queued",
  "provisioning",
  "building",
  "compiling",
  "deploying",
  "exporting",
  "succeeded",
  "failed",
  "killed",
  "paused",
]);

export const buildProvider = pgEnum("build_provider", ["anthropic", "kimi", "openai"]);

export const creditReason = pgEnum("credit_reason", [
  "free_grant",
  "holder_grant",
  "build_debit",
  "build_reserve",
  "build_release",
  "refund",
  "admin_adjust",
  "purchase",
]);

export const abuseVerdict = pgEnum("abuse_verdict", [
  "allow",
  "queue_low",
  "deny",
]);

export const deployer = pgEnum("deployer", ["platform", "user"]);

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  nameSource: text("name_source").notNull().default("legacy").$type<"legacy" | "placeholder" | "agent" | "user">(),
  template: text("template"),
  cfDispatchScriptId: text("cf_dispatch_script_id"),
  sourceR2Key: text("source_r2_key"),
  previewUrl: text("preview_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const builds = pgTable(
  "builds",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    // Text files attached to the brief, written into the workspace before the
    // agent runs. Kept here so a restart writes the same ones again.
    attachments: jsonb("attachments").$type<BuildAttachment[]>(),
    provider: buildProvider("provider").notNull().default("kimi"),
    model: text("model"),
    billingMode: text("billing_mode").$type<"platform" | "own_key">(),
    custodyMode: text("custody_mode").$type<"platform" | "hosted" | "gateway">(),
    credentialId: text("credential_id"),
    credentialVersion: integer("credential_version"),
    capabilities: jsonb("capabilities").$type<{ text: boolean; tools: boolean; images: boolean }>(),
    status: buildStatus("status").notNull().default("queued"),
    triggerRunId: text("trigger_run_id"),
    agentSessionId: text("agent_session_id"),
    sandboxId: text("sandbox_id"),
    pricingQuoteId: text("pricing_quote_id"),
    pricingSnapshot: jsonb("pricing_snapshot").$type<import("@/lib/build/pricing-policy").PricingSnapshot>(),
    tokenBudget: integer("token_budget"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: numeric("cost_usd"),
    // The needs analysis before the agent ran, and whether the agent overrode it.
    needsContract: boolean("needs_contract"),
    needsWallet: boolean("needs_wallet"),
    needsReason: text("needs_reason"),
    needsSource: text("needs_source"),
    needsOverridden: boolean("needs_overridden").notNull().default(false),
    error: text("error"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  function buildsIndexes(table) {
    return {
      userIdIdx: index("builds_user_id_idx").on(table.userId),
      pricingQuoteIdx: uniqueIndex("builds_pricing_quote_unique").on(table.pricingQuoteId).where(sql`${table.pricingQuoteId} is not null`),
      statusIdx: index("builds_status_idx").on(table.status),
      userRecentIdx: index("builds_user_recent_idx").on(table.userId, table.createdAt),
    };
  },
);

export const buildLogs = pgTable(
  "build_logs",
  {
    id: text("id").primaryKey(),
    buildId: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    level: text("level"),
    chunk: text("chunk"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  function buildLogsIndexes(table) {
    return {
      buildIdSeqIdx: index("build_logs_build_id_seq_idx").on(table.buildId, table.seq),
    };
  },
);

export const contracts = pgTable(
  "contracts",
  {
    id: text("id").primaryKey(),
    buildId: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    address: text("address").notNull(),
    txHash: text("tx_hash"),
    abi: jsonb("abi"),
    sourceHash: text("source_hash"),
    // The creation bytecode that went on chain, kept so the same contract can
    // later be deployed to mainnet from the person's own wallet and the
    // transaction checked against it byte for byte.
    bytecode: text("bytecode"),
    // The wallet passed to the constructor as owner. Fletch's key only pays
    // the gas, so this is the person's own address from the first block.
    ownerAddress: text("owner_address"),
    // Set only when Blockscout itself reports the source verified.
    verified: boolean("verified").default(false),
    verifiedAt: timestamp("verified_at"),
    verifyError: text("verify_error"),
    deployer: deployer("deployer").notNull().default("platform"),
    confirmedAt: timestamp("confirmed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  function contractsIndexes(table) {
    return {
      buildIdIdx: index("contracts_build_id_idx").on(table.buildId),
    };
  },
);

// Append-only double-entry ledger. Balance = SUM(delta); never a mutable column.
export const creditEvents = pgTable(
  "credit_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: creditReason("reason").notNull(),
    buildId: text("build_id"),
    externalRef: text("external_ref"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  function creditEventsIndexes(table) {
    return {
      idempotencyKeyIdx: uniqueIndex("credit_events_idempotency_key_idx").on(
        table.idempotencyKey,
      ),
      userIdIdx: index("credit_events_user_id_idx").on(table.userId),
      userRecentIdx: index("credit_events_user_recent_idx").on(table.userId, table.createdAt),
    };
  },
);

// Address claims remain after an account is removed, preventing repeat grants.
export const starterCreditClaims = pgTable("starter_credit_claims", {
  address: text("address").primaryKey(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("starter_credit_address", sql`${table.address} ~ '^0x[0-9a-f]{40}$'`)]);

export const holderCreditClaims = pgTable("holder_credit_claims", {
  id: text("id").primaryKey(),
  campaign: text("campaign").notNull(),
  period: text("period").notNull(),
  address: text("address").notNull(),
  accountKey: text("account_key").notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  policy: jsonb("policy").notNull(),
  evidence: jsonb("evidence").notNull(),
  credits: integer("credits").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("holder_credit_claims_address_idx").on(table.campaign, table.period, table.address),
  uniqueIndex("holder_credit_claims_account_idx").on(table.campaign, table.period, table.accountKey),
  index("holder_credit_claims_created_idx").on(table.campaign, table.createdAt),
  check("holder_credit_claim_address", sql`${table.address} ~ '^0x[0-9a-f]{40}$'`),
  check("holder_credit_claim_amount", sql`${table.credits} = 10`),
]);

export const holderCreditChecks = pgTable("holder_credit_checks", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  period: text("period").notNull(),
  wallet: text("wallet").notNull(),
  lease: text("lease"),
  nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull(),
  result: jsonb("result").notNull(),
});

// Rate limiting has to survive a restart and be shared across instances. In memory
// it did neither: a restart cleared every counter, and a second replica would have
// doubled every ceiling — including the daily spend cap that bounds model cost.
export const rateCounters = pgTable("rate_counters", {
  bucket: text("bucket").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start").notNull().defaultNow(),
});

export const abuseSignals = pgTable("abuse_signals", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  wallet: text("wallet"),
  deviceHash: text("device_hash"),
  ipHash: text("ip_hash"),
  turnstileScore: numeric("turnstile_score"),
  walletAgeDays: integer("wallet_age_days"),
  walletTxCount: integer("wallet_tx_count"),
  verdict: abuseVerdict("verdict").notNull().default("allow"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const fleetNodes = pgTable("fleet_nodes", {
  id: text("id").primaryKey(),
  provider: text("provider"),
  role: text("role"),
  tailscaleHostname: text("tailscale_hostname"),
  status: text("status"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Fletch Watch (docs/MVP.md): registry, watchers, delivery outbox, Telegram ──

export const watcherKind = pgEnum("watcher_kind", ["large_transfer", "wallet_activity", "registry_event", "listing_event", "token_event", "new_pool"]);
export const watcherStatus = pgEnum("watcher_status", ["active", "catching_up", "degraded", "paused"]);
export const deliveryStatus = pgEnum("delivery_status", ["pending", "sent", "failed", "retracted", "held"]);

// Assets a watcher may target. Every row says where it came from and when it was
// last seen and verified, so the registry never carries an address nobody can trace.
export const registryAssets = pgTable(
  "registry_assets",
  {
    // `${chainId}:${address.toLowerCase()}` — one row per deployment.
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    address: text("address").notNull(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    // stock_token | stablecoin | wrapped_native
    assetType: text("asset_type").notNull(),
    decimals: integer("decimals").notNull().default(18),
    status: text("status").notNull().default("active"),
    // robinhood-api | seed
    source: text("source").notNull(),
    sourceUri: text("source_uri"),
    observedAt: timestamp("observed_at").notNull().defaultNow(),
    // Never updated after the insert: the moment Fletch first saw this token on
    // chain. Robinhood publishes no listing date, so this record exists nowhere else.
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    verifiedAt: timestamp("verified_at"),
    // What the contract itself answers for name(), symbol() and decimals(), and
    // when it was last asked. A row is only fully verified when these match the
    // listing: bytecode at the address proves a contract, this proves the contract.
    onchainName: text("onchain_name"),
    onchainSymbol: text("onchain_symbol"),
    onchainDecimals: integer("onchain_decimals"),
    metadataCheckedAt: timestamp("metadata_checked_at"),
    // From Robinhood's listing: the logo, and the ISIN that ties the token to the
    // security it tracks. The ISIN is the join key between this chain and the
    // rest of finance, and no other index of Robinhood Chain carries it.
    logoUrl: text("logo_url"),
    isin: text("isin"),
    raw: jsonb("raw"),
  },
  function registryAssetsIndexes(table) {
    return {
      symbolIdx: index("registry_assets_symbol_idx").on(table.chainId, table.symbol),
      firstSeenIdx: index("registry_assets_first_seen_idx").on(table.chainId, table.firstSeenAt),
    };
  },
);

// An HTTPS endpoint an account registers for watcher alerts. The signing secret
// is stored encrypted (lib/telegram/secret.ts) rather than hashed: the daemon
// needs the plaintext to sign each body, so a one-way hash would not do. It is
// shown once at creation and can be replaced, never read back.
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    secretEnc: text("secret_enc").notNull(),
    secretPrefix: text("secret_prefix").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastDeliveredAt: timestamp("last_delivered_at"),
    lastError: text("last_error"),
    // When lastError was written: a failure last month and one a minute ago are
    // otherwise the same row.
    lastErrorAt: timestamp("last_error_at"),
    // Separate connection tests from attempts to deliver a matched event.
    lastTestAt: timestamp("last_test_at"),
    lastTestStatus: integer("last_test_status"),
    lastTestError: text("last_test_error"),
    lastAlertAt: timestamp("last_alert_at"),
    lastAlertStatus: integer("last_alert_status"),
    lastAlertError: text("last_alert_error"),
  },
  function webhookEndpointsIndexes(table) {
    return {
      userIdx: index("webhook_endpoints_user_idx").on(table.userId),
    };
  },
);

export const watchers = pgTable(
  "watchers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    kind: watcherKind("kind").notNull().default("large_transfer"),
    chainId: integer("chain_id").notNull(),
    address: text("address").notNull(),
    assetId: text("asset_id").references(() => registryAssets.id),
    // Whole tokens, as a decimal string; compared against the decoded amount.
    // Zero means every transfer, which is what a wallet-activity watcher wants.
    threshold: numeric("threshold").notNull(),
    // wallet_activity only: the address whose sends and receipts are watched.
    wallet: text("wallet"),
    // Where this watcher's alerts go. "telegram" is every watcher written
    // before webhooks existed, which is why it is the column default.
    delivery: text("delivery").$type<DeliveryChannel>().notNull().default("telegram"),
    webhookId: text("webhook_id").references(() => webhookEndpoints.id, { onDelete: "set null" }),
    enabled: boolean("enabled").notNull().default(true),
    // The person was told this address did not answer as an ERC-20 and asked
    // for the watcher anyway. Kept so a silent watcher can be explained.
    unverifiedAck: boolean("unverified_ack").notNull().default(false),
    // new_pool only: hear about a new pool only when its token borrows a
    // listed ticker or name.
    lookalikesOnly: boolean("lookalikes_only").notNull().default(false),
    status: watcherStatus("status").notNull().default("catching_up"),
    // The checkpoint, with its hash: a mismatch on the next poll is a reorg.
    lastCheckedBlock: bigint("last_checked_block", { mode: "bigint" }),
    lastCheckedBlockHash: text("last_checked_block_hash"),
    lastTriggeredAt: timestamp("last_triggered_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  function watchersIndexes(table) {
    return {
      userIdIdx: index("watchers_user_id_idx").on(table.userId),
      targetIdx: index("watchers_target_idx").on(table.chainId, table.address),
    };
  },
);

// The outbox. One row per matched event per watcher; the unique index is the
// idempotency key, so a rescanned block can never deliver twice.
export const watcherDeliveries = pgTable(
  "watcher_deliveries",
  {
    id: text("id").primaryKey(),
    watcherId: text("watcher_id")
      .notNull()
      .references(() => watchers.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: text("block_hash").notNull(),
    payload: jsonb("payload").notNull(),
    status: deliveryStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    sentAt: timestamp("sent_at"),
  },
  function deliveriesIndexes(table) {
    return {
      eventIdx: uniqueIndex("watcher_deliveries_event_idx").on(table.watcherId, table.txHash, table.logIndex),
      queueIdx: index("watcher_deliveries_queue_idx").on(table.status, table.nextAttemptAt),
      // The dashboard reads deliveries by person and by watcher, newest first.
      userRecentIdx: index("watcher_deliveries_user_recent_idx").on(table.userId, table.createdAt),
      watcherRecentIdx: index("watcher_deliveries_watcher_recent_idx").on(table.watcherId, table.createdAt),
    };
  },
);

export const telegramAccounts = pgTable("telegram_accounts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  chatId: text("chat_id").notNull(),
  username: text("username"),
  linkedAt: timestamp("linked_at").notNull().defaultNow(),
});

// A person's own bot, made with BotFather and pasted into Settings. The token is
// stored encrypted (lib/telegram/secret.ts) and decrypted only to send. With a
// row here, that account's alerts go through this bot instead of the platform's.
export const telegramBots = pgTable("telegram_bots", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  tokenEnc: text("token_enc").notNull(),
  botId: text("bot_id").notNull(),
  botUsername: text("bot_username").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastCheckedAt: timestamp("last_checked_at"),
});

// Short-lived, single-use; the /start payload the bot receives.
export const telegramLinkTokens = pgTable("telegram_link_tokens", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
});

// The daemon writes one row per loop; the status card reads it. A stale beat is
// how the UI knows the 24/7 promise is currently untrue.
export const daemonHeartbeats = pgTable("daemon_heartbeats", {
  name: text("name").primaryKey(),
  lastBeatAt: timestamp("last_beat_at").notNull().defaultNow(),
  headBlock: bigint("head_block", { mode: "bigint" }),
  detail: jsonb("detail"),
});

// ── Phase 0 of the platform (spec ch. 0.5): API keys and an audit trail ──

// A key is shown once; only its SHA-256 is stored. The prefix is what the person
// sees in the list so they can tell keys apart.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull().unique(),
    // registry:read, watchers:read, watchers:write, builds:read, projects:read
    scopes: jsonb("scopes").notNull(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  function apiKeysIndexes(table) {
    return {
      userIdIdx: index("api_keys_user_id_idx").on(table.userId),
    };
  },
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    // user | api_key | system
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  function auditIndexes(table) {
    return {
      userIdx: index("audit_log_user_idx").on(table.userId, table.createdAt),
    };
  },
);

// ---------------------------------------------------------------------------
// Registry authority: what Fletch keeps current about every asset beyond its
// listing. Written only by workers/registry.ts; read by the registry pages and
// the v1 API. Every number here was read from the chain or the issuer's API by
// a named job whose run is recorded in sync_runs, so a stale figure can be
// traced to the run that last refreshed it.

// One row per asset: the current on-chain truth, refreshed by several jobs on
// their own cadences. Nullable columns mean "not read yet" or "this asset does
// not expose it" (USDG has no multiplier), never zero.
export const registryAssetState = pgTable("registry_asset_state", {
  assetId: text("asset_id")
    .primaryKey()
    .references(() => registryAssets.id, { onDelete: "cascade" }),
  chainId: integer("chain_id").notNull(),
  address: text("address").notNull(),
  // ERC-8056: dividends raise this instead of paying out. Exposure = raw × multiplier.
  uiMultiplier: numeric("ui_multiplier"),
  newUiMultiplier: numeric("new_ui_multiplier"),
  multiplierEffectiveAt: timestamp("multiplier_effective_at"),
  tokenPaused: boolean("token_paused"),
  oraclePaused: boolean("oracle_paused"),
  totalSupplyRaw: numeric("total_supply_raw"),
  totalSupplyUi: numeric("total_supply_ui"),
  stateCheckedAt: timestamp("state_checked_at"),
  stateError: text("state_error"),
  // Beacon dependency observation: the proxy's beacon slot points at the issuer's
  // registry. The match does not establish who deployed the referring contract.
  beaconAddress: text("beacon_address"),
  implementationAddress: text("implementation_address"),
  codeHash: text("code_hash"),
  canonical: boolean("canonical"),
  canonicalCheckedAt: timestamp("canonical_checked_at"),
  // Chainlink, when a feed exists for the symbol: the price already includes the multiplier.
  feedAddress: text("feed_address"),
  feedPrice: numeric("feed_price"),
  feedUpdatedAt: timestamp("feed_updated_at"),
  feedStale: boolean("feed_stale"),
  feedCheckedAt: timestamp("feed_checked_at"),
  // Robinhood's price API: bid and ask are the underlying, without the multiplier.
  apiBid: numeric("api_bid"),
  apiAsk: numeric("api_ask"),
  apiMultiplier: numeric("api_multiplier"),
  apiTradingHalt: boolean("api_trading_halt"),
  apiDailyVolume: numeric("api_daily_volume"),
  apiCheckedAt: timestamp("api_checked_at"),
  apiError: text("api_error"),
  // Feed price against API mid × on-chain multiplier, as a percentage.
  priceDivergencePct: numeric("price_divergence_pct"),
    // A second source for the numbers above: what Blockscout's own indexer
    // counts. `supplyAgreement` is agree / close / differ / unknown between
    // Blockscout's total supply and the contract's answer read here.
    blockscoutHolders: integer("blockscout_holders"),
    blockscoutTransfers: bigint("blockscout_transfers", { mode: "bigint" }),
    blockscoutTotalSupplyRaw: numeric("blockscout_total_supply_raw"),
    blockscoutCheckedAt: timestamp("blockscout_checked_at"),
    supplyAgreement: text("supply_agreement"),
    // The deepest pool of any venue for this asset — the one it takes the most
    // dollars to move 1% — and how far that price sits from the Chainlink feed
    // (which already carries the multiplier).
    dexPoolId: text("dex_pool_id"),
    dexVenue: text("dex_venue"),
    dexPriceUsd: numeric("dex_price_usd"),
    dexLiquidity: numeric("dex_liquidity"),
    dexDepthUsd: numeric("dex_depth_usd"),
    dexPremiumPct: numeric("dex_premium_pct"),
    dexCheckedAt: timestamp("dex_checked_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// The issuer's control plane: every event on the AccessControlsRegistry, which
// is at once the upgrade beacon, the global pause, the blocklist and the role
// registry for every Stock Token. Append-only.
export const registryControlEvents = pgTable(
  "registry_control_events",
  {
    // `${chainId}:${txHash}:${logIndex}`
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: text("block_hash").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    // Blocked | Unblocked | RoleGranted | RoleRevoked | Paused | Unpaused | Upgraded | RoleAdminChanged
    event: text("event").notNull(),
    account: text("account"),
    role: text("role"),
    implementation: text("implementation"),
    observedAt: timestamp("observed_at").notNull().defaultNow(),
  },
  function registryControlEventsIndexes(table) {
    return {
      blockIdx: index("registry_control_events_block_idx").on(table.chainId, table.blockNumber),
      accountIdx: index("registry_control_events_account_idx").on(table.account),
    };
  },
);

// What the registry contract answers at head, plus counts derived from the
// event log, so a page can say "175 addresses blocked, not paused" without a scan.
export const registryControlState = pgTable("registry_control_state", {
  chainId: integer("chain_id").primaryKey(),
  registryAddress: text("registry_address").notNull(),
  implementation: text("implementation"),
  paused: boolean("paused"),
  blockedCount: integer("blocked_count"),
  lastEventBlock: bigint("last_event_block", { mode: "bigint" }),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
});

// Every multiplier change, per token, as the contract announced it.
export const registryMultiplierEvents = pgTable(
  "registry_multiplier_events",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").references(() => registryAssets.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    address: text("address").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    oldMultiplier: numeric("old_multiplier").notNull(),
    newMultiplier: numeric("new_multiplier").notNull(),
    effectiveAt: timestamp("effective_at").notNull(),
    observedAt: timestamp("observed_at").notNull().defaultNow(),
  },
  function registryMultiplierEventsIndexes(table) {
    return {
      assetIdx: index("registry_multiplier_events_asset_idx").on(table.assetId, table.blockNumber),
    };
  },
);

// Mints and burns: transfers from or to the zero address, with the counterparty.
export const registrySupplyEvents = pgTable(
  "registry_supply_events",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").references(() => registryAssets.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    address: text("address").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    // mint | burn
    kind: text("kind").notNull(),
    counterparty: text("counterparty").notNull(),
    valueRaw: numeric("value_raw").notNull(),
    observedAt: timestamp("observed_at").notNull().defaultNow(),
  },
  function registrySupplyEventsIndexes(table) {
    return {
      assetIdx: index("registry_supply_events_asset_idx").on(table.assetId, table.blockNumber),
    };
  },
);

// One row per asset per UTC day: what was minted and burned, what the contract
// says the supply is, and the difference. A non-zero residual is the finding
// rwa.xyz published about naive supply sums; here it is measured, not assumed.
export const registrySupplySnapshots = pgTable("registry_supply_snapshots", {
  id: text("id").primaryKey(),
  assetId: text("asset_id")
    .notNull()
    .references(() => registryAssets.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  totalSupplyRaw: numeric("total_supply_raw").notNull(),
  mintedRaw: numeric("minted_raw").notNull(),
  burnedRaw: numeric("burned_raw").notNull(),
  residualRaw: numeric("residual_raw").notNull(),
  headBlock: bigint("head_block", { mode: "bigint" }).notNull(),
  takenAt: timestamp("taken_at").notNull().defaultNow(),
});

// Robinhood's corporate-actions feed, one row per action id, upserted hourly.
export const registryCorporateActions = pgTable(
  "registry_corporate_actions",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    assetId: text("asset_id").references(() => registryAssets.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    processDate: text("process_date"),
    rate: numeric("rate"),
    payload: jsonb("payload").notNull(),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  function registryCorporateActionsIndexes(table) {
    return {
      symbolIdx: index("registry_corporate_actions_symbol_idx").on(table.symbol, table.processDate),
    };
  },
);

// The chain's vital signs, one row per reading; the latest row is what pages show.
export const chainHealth = pgTable(
  "chain_health",
  {
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    checkedAt: timestamp("checked_at").notNull().defaultNow(),
    headBlock: bigint("head_block", { mode: "bigint" }).notNull(),
    blockTimeMs: integer("block_time_ms"),
    baseFeeWei: numeric("base_fee_wei"),
    l1Block: bigint("l1_block", { mode: "bigint" }),
    batchCount: bigint("batch_count", { mode: "bigint" }),
    delayedMessages: bigint("delayed_messages", { mode: "bigint" }),
    batchPosterBalanceWei: numeric("batch_poster_balance_wei"),
    statusPage: text("status_page"),
    detail: jsonb("detail"),
    // Finality and governance: the latest assertion confirmed on Ethereum and
    // how old it is, the ArbOS version, and who may change the chain.
    arbosVersion: integer("arbos_version"),
    chainOwners: jsonb("chain_owners"),
    latestConfirmedAssertion: text("latest_confirmed_assertion"),
    confirmedAtL1Block: bigint("confirmed_at_l1_block", { mode: "bigint" }),
    confirmedAgeSeconds: integer("confirmed_age_seconds"),
  },
  function chainHealthIndexes(table) {
    return {
      recentIdx: index("chain_health_recent_idx").on(table.chainId, table.checkedAt),
    };
  },
);

// Where each log scanner has read to, with the block hash so a reorg is seen.
export const syncCheckpoints = pgTable("sync_checkpoints", {
  name: text("name").primaryKey(),
  chainId: integer("chain_id").notNull(),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  blockHash: text("block_hash").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Where each scanner's checkpoint stood over the last two days, one row per
// commit, so a rate and a stall are measured from movement rather than
// inferred from run bookkeeping.
export const syncCheckpointHistory = pgTable(
  "sync_checkpoint_history",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    at: timestamp("at").notNull().defaultNow(),
  },
  function historyIndexes(table) {
    return { nameAtIdx: index("sync_checkpoint_history_name_at_idx").on(table.name, table.at) };
  },
);

// Every ETL run, whether it succeeded, how many rows it touched, and why it
// failed if it did. fletch-ops reads this to say which job last ran when.
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: text("id").primaryKey(),
    job: text("job").notNull(),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
    ok: boolean("ok"),
    rows: integer("rows"),
    error: text("error"),
    detail: jsonb("detail"),
  },
  function syncRunsIndexes(table) {
    return {
      jobIdx: index("sync_runs_job_idx").on(table.job, table.startedAt),
    };
  },
);

// Everything the authority daemon noticed changing, in one append-only stream:
// the registry paused, an address blocked, a multiplier scheduled, a feed gone
// stale, a residual appearing, a new listing. The Watch matcher, the public
// changelog and the SSE stream all read this table; none of them knows how an
// event was detected. `matched_at` is set once the matcher has fanned it out.
export const authorityEvents = pgTable(
  "authority_events",
  {
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    kind: text("kind").notNull(),
    assetId: text("asset_id"),
    address: text("address"),
    symbol: text("symbol"),
    title: text("title").notNull(),
    detail: jsonb("detail"),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    txHash: text("tx_hash"),
    occurredAt: timestamp("occurred_at").notNull(),
    observedAt: timestamp("observed_at").notNull().defaultNow(),
    matchedAt: timestamp("matched_at"),
  },
  function authorityEventsIndexes(table) {
    return {
      recentIdx: index("authority_events_recent_idx").on(table.chainId, table.observedAt),
      assetIdx: index("authority_events_asset_idx").on(table.assetId, table.observedAt),
      unmatchedIdx: index("authority_events_unmatched_idx").on(table.matchedAt).where(sql`matched_at is null`),
    };
  },
);

// Recorded name/ticker collisions. Beacon addresses describe dependencies,
// never issuer origin. Historical unlisted_stock kinds are interpreted as
// unverified by readers without rewriting the stored observation.
export const lookalikeTokens = pgTable(
  "lookalike_tokens",
  {
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    address: text("address").notNull(),
    symbol: text("symbol"),
    name: text("name"),
    decimals: integer("decimals"),
    holders: integer("holders"),
    totalSupplyRaw: numeric("total_supply_raw"),
    matchesAssetId: text("matches_asset_id").notNull(),
    matchesSymbol: text("matches_symbol").notNull(),
    kind: text("kind").notNull(),
    exactName: boolean("exact_name").notNull().default(false),
    beacon: text("beacon"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  function lookalikeIndexes(table) {
    return {
      assetIdx: index("lookalike_tokens_asset_idx").on(table.matchesAssetId, table.holders),
      chainIdx: index("lookalike_tokens_chain_idx").on(table.chainId, table.holders),
      addressIdx: index("lookalike_tokens_address_idx").on(table.chainId, table.address),
    };
  },
);

// Every Chainlink round the daemon has seen or backfilled, per feed: the
// answer history behind each price, so a chart or an agent can read what the
// feed said at any moment rather than only now. `roundId` is the proxy's
// phase-encoded uint80, stored as a decimal string.
export const feedRounds = pgTable(
  "feed_rounds",
  {
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    feedAddress: text("feed_address").notNull(),
    assetId: text("asset_id"),
    symbol: text("symbol"),
    roundId: numeric("round_id").notNull(),
    answer: numeric("answer").notNull(),
    startedAt: timestamp("started_at"),
    updatedAt: timestamp("updated_at").notNull(),
    observedAt: timestamp("observed_at").notNull().defaultNow(),
  },
  function feedRoundIndexes(table) {
    return {
      feedIdx: index("feed_rounds_feed_idx").on(table.feedAddress, table.roundId),
      assetIdx: index("feed_rounds_asset_idx").on(table.assetId, table.updatedAt),
    };
  },
);

// Who holds each asset, kept as running balances from every Transfer the
// ledger scanner has applied; no per-transfer rows are stored. Balances are
// exact raw units, so a holder's share is raw / totalSupplyRaw.
export const holderBalances = pgTable(
  "holder_balances",
  {
    assetId: text("asset_id").notNull(),
    holder: text("holder").notNull(),
    rawBalance: numeric("raw_balance").notNull(),
    updatedBlock: bigint("updated_block", { mode: "bigint" }).notNull(),
  },
  function holderIndexes(table) {
    return {
      pk: primaryKey({ columns: [table.assetId, table.holder] }),
      topIdx: index("holder_balances_top_idx").on(table.assetId, table.rawBalance),
    };
  },
);

// One row per asset per UTC day: transfers as economics. DvP is a transfer
// whose transaction also moved USDG; off-hours is a transfer outside US
// equity market hours, which only a tokenised stock can have.
export const assetActivityDaily = pgTable(
  "asset_activity_daily",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull(),
    day: text("day").notNull(),
    transfers: integer("transfers").notNull().default(0),
    volumeRaw: numeric("volume_raw").notNull().default("0"),
    mints: integer("mints").notNull().default(0),
    burns: integer("burns").notNull().default(0),
    dvpTransfers: integer("dvp_transfers").notNull().default(0),
    offhoursTransfers: integer("offhours_transfers").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  function activityIndexes(table) {
    return {
      assetDayIdx: index("asset_activity_daily_asset_idx").on(table.assetId, table.day),
    };
  },
);

// A daily reading of how concentrated each asset's holding is, from
// holder_balances: holders with a balance, the largest holder's share, the
// top ten's share, a Gini coefficient, and the share held by the address
// that receives the issuer's mints.
export const assetConcentration = pgTable(
  "asset_concentration",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull(),
    day: text("day").notNull(),
    holders: integer("holders").notNull(),
    top1Pct: numeric("top1_pct"),
    top10Pct: numeric("top10_pct"),
    gini: numeric("gini"),
    issuerPct: numeric("issuer_pct"),
    issuerAddress: text("issuer_address"),
    // Where the supply sits, from holder_balances joined to holder_labels:
    // pools (the Uniswap v4 PoolManager and any pool contract), the issuer's
    // wallets, the bridge gateways, every other contract, what the code probe
    // has not reached yet, and the float left in ordinary wallets. The six
    // add up to 100.
    poolsPct: numeric("pools_pct"),
    bridgePct: numeric("bridge_pct"),
    contractsPct: numeric("contracts_pct"),
    unknownPct: numeric("unknown_pct"),
    floatPct: numeric("float_pct"),
    headBlock: bigint("head_block", { mode: "bigint" }).notNull(),
    takenAt: timestamp("taken_at").notNull().defaultNow(),
  },
  function concentrationIndexes(table) {
    return {
      assetDayIdx: index("asset_concentration_asset_idx").on(table.assetId, table.day),
    };
  },
);

// What an address is, when it is not a person's wallet. One row per address,
// shared by every asset it holds: the Uniswap v4 PoolManager holds AMC and
// SNAP and PFE, and it is the same fact each time. `kind` decides which share
// of the supply an address's balance counts towards; `eoa` is the cached
// answer of the code probe (no bytecode), which keeps the next run from asking
// the RPC about the same tens of thousands of ordinary wallets again.
export const holderLabels = pgTable(
  "holder_labels",
  {
    address: text("address").primaryKey(),
    label: text("label").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    checkedAt: timestamp("checked_at").notNull().defaultNow(),
  },
  function holderLabelIndexes(table) {
    return {
      kindIdx: index("holder_labels_kind_idx").on(table.kind),
    };
  },
);

// One row per asset per UTC day: every live number the registry publishes for
// that asset, copied from registry_asset_state and the counts beside it at the
// moment the daily job ran. The live tables hold only "now"; this is the only
// place a question like "what was TSLA's premium on 2026-08-12" can be
// answered. A null column means the figure was not read that day, never zero.
export const assetStateDaily = pgTable(
  "asset_state_daily",
  {
    // `${assetId}:${day}`, so a restart on the same day rewrites its own row.
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull(),
    day: text("day").notNull(),
    uiMultiplier: numeric("ui_multiplier"),
    tokenPaused: boolean("token_paused"),
    oraclePaused: boolean("oracle_paused"),
    apiTradingHalt: boolean("api_trading_halt"),
    feedPrice: numeric("feed_price"),
    feedStale: boolean("feed_stale"),
    apiBid: numeric("api_bid"),
    apiAsk: numeric("api_ask"),
    priceDivergencePct: numeric("price_divergence_pct"),
    dexPriceUsd: numeric("dex_price_usd"),
    dexPremiumPct: numeric("dex_premium_pct"),
    dexLiquidity: numeric("dex_liquidity"),
    totalSupplyRaw: numeric("total_supply_raw"),
    blockscoutHolders: integer("blockscout_holders"),
    ledgerHolders: integer("ledger_holders"),
    lookalikes: integer("lookalikes"),
    // When each writer last read the figures beside it. A column above is
    // written only on a day its own checked-at falls on, so a null there is a
    // figure nobody read that day rather than a stale answer copied forward.
    stateCheckedAt: timestamp("state_checked_at"),
    feedCheckedAt: timestamp("feed_checked_at"),
    apiCheckedAt: timestamp("api_checked_at"),
    dexCheckedAt: timestamp("dex_checked_at"),
    blockscoutCheckedAt: timestamp("blockscout_checked_at"),
    takenAt: timestamp("taken_at").notNull().defaultNow(),
  },
  function assetStateDailyIndexes(table) {
    return {
      assetDayIdx: index("asset_state_daily_asset_idx").on(table.assetId, table.day),
      dayIdx: index("asset_state_daily_day_idx").on(table.day),
    };
  },
);

// DEX pools whose currencies include a registry asset, with the price and
// liquidity last read and the last day's swaps. `assetId` is the registry
// side; `quoteAssetId` the other side when it is also listed (USDG, WETH,
// another Stock Token), else null for a memecoin pair. `venue` says which
// DEX: a v4 pool is an id inside one PoolManager and has no address of its
// own, a v3 pool is a contract and carries `poolAddress`.
export const dexPools = pgTable(
  "dex_pools",
  {
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    venue: text("venue").notNull().default("uniswap_v4"),
    poolAddress: text("pool_address"),
    currency0: text("currency0").notNull(),
    currency1: text("currency1").notNull(),
    fee: integer("fee").notNull(),
    tickSpacing: integer("tick_spacing").notNull(),
    hooks: text("hooks").notNull(),
    // The listed asset the pool trades, or null for a community pool, whose
    // unlisted side is tokenAddress and described in dex_tokens.
    assetId: text("asset_id"),
    tokenAddress: text("token_address"),
    quoteAssetId: text("quote_asset_id"),
    createdBlock: bigint("created_block", { mode: "bigint" }).notNull(),
    canonical: boolean("canonical").notNull().default(true),
    createdBlockHash: text("created_block_hash"),
    createdTxHash: text("created_tx_hash"),
    createdLogIndex: integer("created_log_index"),
    swapsIndexedFromBlock: bigint("swaps_indexed_from_block", { mode: "bigint" }),
    swapsIndexedFromAt: timestamp("swaps_indexed_from_at"),
    metricsAsOf: timestamp("metrics_as_of"),
    transactions24h: integer("transactions_24h"),
    sqrtPriceX96: numeric("sqrt_price_x96"),
    tick: integer("tick"),
    liquidity: numeric("liquidity"),
    priceInQuote: numeric("price_in_quote"),
    priceUsd: numeric("price_usd"),
    // Both sides of the pool's virtual reserves in dollars. Uniswap's L is
    // comparable only within a pair, so this is the figure pools are ranked by.
    depthUsd: numeric("depth_usd"),
    stateCheckedAt: timestamp("state_checked_at"),
    stateAttemptedAt: timestamp("state_attempted_at"),
    stateRetryAt: timestamp("state_retry_at"),
    stateFailures: integer("state_failures").notNull().default(0),
    // Null until the pool has been on record for the whole rollup window: the
    // swap scan never read the blocks before the pool was discovered.
    swaps24h: integer("swaps_24h"),
    volumeUsd24h: numeric("volume_usd_24h"),
    // active, quiet or dormant: how often the daemon reads the pool and
    // whether the default views show it. See dex-tiers.ts for the rule.
    tier: text("tier").notNull().default("active"),
    lastSwapAt: timestamp("last_swap_at"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  },
  function dexPoolIndexes(table) {
    return {
      currency0Idx: index("dex_pools_currency0_idx").on(table.chainId, table.currency0),
      currency1Idx: index("dex_pools_currency1_idx").on(table.chainId, table.currency1),
      assetIdx: index("dex_pools_asset_idx").on(table.assetId, table.liquidity),
      depthIdx: index("dex_pools_asset_depth_idx").on(table.assetId, table.depthUsd),
      chainIdx: index("dex_pools_chain_idx").on(table.chainId),
      tokenIdx: index("dex_pools_token_idx").on(table.tokenAddress),
      pendingTokenIdx: index("dex_pools_pending_token_idx").on(table.chainId, table.tokenAddress)
        .where(sql`${table.canonical} and ${table.tokenAddress} is not null`),
      tierIdx: index("dex_pools_chain_tier_idx").on(table.chainId, table.tier),
      venueIdx: index("dex_pools_venue_idx").on(table.chainId, table.venue),
      stateRetryIdx: index("dex_pools_state_retry_idx").on(table.chainId, table.stateRetryAt),
    };
  },
);

// Swaps per pool per UTC day, from the PoolManager's Swap events: counts and
// the absolute amounts moved on each side.
// What the chain says about a token that trades on a DEX without being on
// Robinhood's list: name, symbol, decimals and supply, read from the contract.
// Nothing here is verified; a row says the token exists and what it calls
// itself, which is what a market table needs and all it may claim.
export const dexTokens = pgTable(
  "dex_tokens",
  {
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    address: text("address").notNull(),
    symbol: text("symbol"),
    name: text("name"),
    decimals: integer("decimals"),
    totalSupplyRaw: numeric("total_supply_raw"),
    // How Fletch first saw this address: a factory event, or a person pasting
    // it into the watch form. Provenance, not a judgement.
    source: text("source").notNull().default("factory_scan"),
    bytecodePresent: boolean("bytecode_present"),
    firstSeenBlock: bigint("first_seen_block", { mode: "bigint" }),
    // An operator's spam flag. The row stays, and stays watchable by address;
    // it leaves the default listings.
    hidden: boolean("hidden").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    checkedAt: timestamp("checked_at"),
    error: text("error"),
    // Held at the two addresses nothing can spend from: 0x…dEaD and the zero
    // address. Supply minus this is what market cap is priced on.
    burnedRaw: numeric("burned_raw"),
    supplyCheckedAt: timestamp("supply_checked_at"),
  },
  function dexTokenIndexes(table) {
    return {
      chainIdx: index("dex_tokens_chain_idx").on(table.chainId, table.symbol),
      addressIdx: index("dex_tokens_address_idx").on(table.chainId, table.address),
      lookalikeScanIdx: index("dex_tokens_lookalike_scan_idx").on(table.chainId, table.address).where(sql`${table.checkedAt} is not null`),
      discoveriesIdx: index("dex_tokens_discoveries_idx").on(table.chainId, table.firstSeenAt.desc(), table.address)
        .where(sql`not ${table.hidden} and ${table.bytecodePresent} = true and ${table.checkedAt} is not null and ${table.error} is null and ${table.symbol} is not null and btrim(${table.symbol}) <> ''`),
    };
  },
);

// A dollar price per priced pool every few minutes, two days deep, from
// which a pool's move over 5 minutes, an hour, six and a day is read.
export const dexPriceSamples = pgTable(
  "dex_price_samples",
  {
    poolId: text("pool_id").notNull(),
    at: timestamp("at").notNull(),
    priceUsd: numeric("price_usd").notNull(),
  },
  function sampleIndexes(table) {
    return {
      pk: primaryKey({ columns: [table.poolId, table.at] }),
      atIdx: index("dex_price_samples_at_idx").on(table.at),
    };
  },
);

export const dexSwapsDaily = pgTable(
  "dex_swaps_daily",
  {
    id: text("id").primaryKey(),
    poolId: text("pool_id").notNull(),
    day: text("day").notNull(),
    swaps: integer("swaps").notNull().default(0),
    volume0Raw: numeric("volume0_raw").notNull().default("0"),
    volume1Raw: numeric("volume1_raw").notNull().default("0"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  function swapIndexes(table) {
    return {
      poolDayIdx: index("dex_swaps_daily_pool_idx").on(table.poolId, table.day),
    };
  },
);

// Token bridge flows seen on L2: every deposit finalised and every
// withdrawal initiated through the gateways, per bridged asset. A withdrawal
// becomes claimable on L1 after the challenge window; whether it was claimed
// shows in the escrow, not here.
export const bridgeFlows = pgTable(
  "bridge_flows",
  {
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    direction: text("direction").notNull(),
    l1Token: text("l1_token").notNull(),
    assetId: text("asset_id"),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    amountRaw: numeric("amount_raw").notNull(),
    l2ToL1Id: numeric("l2_to_l1_id"),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
    claimableAt: timestamp("claimable_at"),
  },
  function bridgeFlowIndexes(table) {
    return {
      assetIdx: index("bridge_flows_asset_idx").on(table.assetId, table.occurredAt),
      chainIdx: index("bridge_flows_chain_idx").on(table.chainId, table.occurredAt),
    };
  },
);

// What backs each bridged asset: the L1 gateway's escrow against the L2
// supply. Escrow above supply is value in flight (deposits not yet
// finalised, or withdrawals burned on L2 and not yet claimed on L1).
export const bridgeEscrow = pgTable("bridge_escrow", {
  assetId: text("asset_id").primaryKey(),
  chainId: integer("chain_id").notNull(),
  l1Token: text("l1_token").notNull(),
  l1Gateway: text("l1_gateway").notNull(),
  escrowRaw: numeric("escrow_raw").notNull(),
  l2SupplyRaw: numeric("l2_supply_raw"),
  inFlightRaw: numeric("in_flight_raw"),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
});

// The issuer's paperwork as the legal hub lists it: one row per PDF, kept
// by its CDN ETag and Last-Modified so a change is noticed without
// downloading two hundred prospectuses.
export const issuerDocuments = pgTable("issuer_documents", {
  url: text("url").primaryKey(),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  underlying: text("underlying"),
  assetId: text("asset_id"),
  etag: text("etag"),
  lastModified: timestamp("last_modified"),
  bytes: bigint("bytes", { mode: "bigint" }),
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  changedAt: timestamp("changed_at"),
  goneAt: timestamp("gone_at"),
});

// Pages whose words matter (restricted jurisdictions, corporate actions,
// upgrade notices), kept as a hash of their text so an edit is an event.
export const issuerPages = pgTable("issuer_pages", {
  slug: text("slug").primaryKey(),
  url: text("url").notNull(),
  title: text("title"),
  sha256: text("sha256").notNull(),
  excerpt: text("excerpt"),
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  changedAt: timestamp("changed_at"),
});

// One row per admin unlock, keyed by the cookie's nonce, so Lock revokes the
// unlock everywhere rather than only deleting one browser's copy.
export const adminSessions = pgTable("admin_sessions", {
  nonce: text("nonce").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
});

// Operator settings that outlive a deploy: the discovered-token liquidity
// floor is the first. Every write goes through lib/admin/actions.ts and lands
// in audit_log, like every other operator action.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

// A model key someone brought themselves. The key is encrypted at rest with the
// same helper as Telegram tokens; `keyPrefix` is the first few characters in
// clear, so a person can tell two keys apart without either being readable.
export const userModelKeys = pgTable(
  "user_model_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model"),
    version: integer("version").notNull().default(1),
    revokedAt: timestamp("revoked_at"),
    validationStatus: text("validation_status").notNull().default("unvalidated"),
    validatedAt: timestamp("validated_at"),
    keyPrefix: text("key_prefix").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
  },
  function userModelKeyIndexes(table) {
    return {
      ownerIdx: uniqueIndex("user_model_keys_owner_idx").on(table.userId, table.provider),
    };
  },
);


export const modelGateways = pgTable("model_gateways", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  label: text("label").notNull(),
  version: integer("version").notNull().default(1),
  pairingHash: text("pairing_hash"),
  pairingExpiresAt: timestamp("pairing_expires_at").notNull(),
  tokenHash: text("token_hash"),
  pairedAt: timestamp("paired_at"),
  revokedAt: timestamp("revoked_at"),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const gatewayRequests = pgTable("gateway_requests", {
  id: text("id").primaryKey(),
  gatewayId: text("gateway_id").notNull().references(() => modelGateways.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  buildId: text("build_id").notNull().references(() => builds.id, { onDelete: "cascade" }),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  result: jsonb("result").$type<{ status: number; body: Record<string, unknown> }>(),
  status: text("status").notNull().default("pending"),
  responseHash: text("response_hash"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Demand requests coordinate bounded reads; chain observations stay in their own tables.
export const marketRefreshRequests = pgTable("market_refresh_requests", {
  id: text("id").primaryKey(),
  chainId: integer("chain_id").notNull(),
  kind: text("kind").notNull(),
  target: text("target").notNull(),
  pending: boolean("pending").notNull().default(true),
  priority: numeric("priority", { precision: 38, scale: 2 }).notNull().default("0"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  leaseToken: text("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  lastError: text("last_error"),
});

// Standalone exact swap index, deployable without discovery migrations 0048/0049.
export const marketSwapEvents = pgTable("market_swap_events", {
  chainId: integer("chain_id").notNull(), blockHash: text("block_hash").notNull(),
  txHash: text("tx_hash").notNull(), logIndex: integer("log_index").notNull(),
  poolId: text("pool_id").notNull(), blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  amount0Raw: numeric("amount0_raw").notNull(), amount1Raw: numeric("amount1_raw").notNull(),
  canonical: boolean("canonical").notNull().default(true), observedAt: timestamp("observed_at").notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.chainId, table.blockHash, table.txHash, table.logIndex] }),
  index("market_swap_events_pool_block_idx").on(table.chainId, table.poolId, table.blockNumber).where(sql`${table.canonical}`),
  index("market_swap_events_chain_block_idx").on(table.chainId, table.blockNumber).where(sql`${table.canonical}`)]);
export const marketSwapRanges = pgTable("market_swap_ranges", {
  id: text("id").primaryKey(), chainId: integer("chain_id").notNull(), poolId: text("pool_id"),
  fromBlock: bigint("from_block", { mode: "bigint" }).notNull(), throughBlock: bigint("through_block", { mode: "bigint" }).notNull(),
  fromHash: text("from_hash").notNull(), throughHash: text("through_hash").notNull(),
  observedAt: timestamp("observed_at").notNull().defaultNow(), canonical: boolean("canonical").notNull().default(true),
}, (table) => [index("market_swap_ranges_chain_pool_idx").on(table.chainId, table.poolId, table.throughBlock)]);
export const marketSwapIndexState = pgTable("market_swap_index_state", {
  chainId: integer("chain_id").primaryKey(),
  liveStartBlock: bigint("live_start_block", { mode: "bigint" }).notNull(), liveStartAt: timestamp("live_start_at").notNull(),
  throughBlock: bigint("through_block", { mode: "bigint" }).notNull(), throughAt: timestamp("through_at").notNull(), throughHash: text("through_hash").notNull(),
  windowStartBlock: bigint("window_start_block", { mode: "bigint" }).notNull(), windowStartAt: timestamp("window_start_at").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const marketPoolSwapMetrics = pgTable("market_pool_swap_metrics", {
  chainId: integer("chain_id").notNull(), poolId: text("pool_id").notNull(),
  enrolledFromBlock: bigint("enrolled_from_block", { mode: "bigint" }).notNull(), coveredFromBlock: bigint("covered_from_block", { mode: "bigint" }).notNull(),
  factoryCreatedBlock: bigint("factory_created_block", { mode: "bigint" }).notNull(), factoryCreatedHash: text("factory_created_hash"),
  asOfBlock: bigint("as_of_block", { mode: "bigint" }), asOfAt: timestamp("as_of_at"), windowStartAt: timestamp("window_start_at"),
  coverageComplete: boolean("coverage_complete").notNull().default(false), swaps: integer("swaps"), transactions: integer("transactions"),
  volume0Raw: numeric("volume0_raw"), volume1Raw: numeric("volume1_raw"), volumeUsd: numeric("volume_usd"),
}, (table) => [primaryKey({ columns: [table.chainId, table.poolId] }),
  index("market_pool_swap_metrics_backfill_idx").on(table.chainId, table.coveredFromBlock)]);

export const robinhoodAppPairs = pgTable("robinhood_app_pairs", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  pair: jsonb("pair").$type<import("@/lib/registry/app-catalog-model").CatalogPair>().notNull(),
  present: boolean("present").notNull().default(true),
  firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
}, (table) => [index("robinhood_app_pairs_symbol_idx").on(table.symbol)]);

export const robinhoodAppSync = pgTable("robinhood_app_sync", {
  id: text("id").primaryKey(),
  observedAt: timestamp("observed_at", { withTimezone: true }),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
  error: text("error"),
  pairCount: integer("pair_count").notNull().default(0),
});

export const registryExplorerSearches = pgTable("registry_explorer_searches", {
  chainId: integer("chain_id").notNull(), symbol: text("symbol").notNull(),
  catalogAt: timestamp("catalog_at", { withTimezone: true }), attemptedAt: timestamp("attempted_at", { withTimezone: true }),
  observedAt: timestamp("observed_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }),
  nextPage: jsonb("next_page"), error: text("error"),
}, (table) => [primaryKey({ columns: [table.chainId, table.symbol] })]);

export const registryExplorerCandidates = pgTable("registry_explorer_candidates", {
  chainId: integer("chain_id").notNull(), address: text("address").notNull(), catalogSymbol: text("catalog_symbol").notNull(),
  reportedSymbol: text("reported_symbol"), reportedName: text("reported_name"),
  firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull().defaultNow(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.chainId, table.address] }),
  index("registry_explorer_candidates_due_idx").on(table.chainId, table.attemptedAt, table.firstObservedAt),
  check("registry_explorer_candidates_address_check", sql`${table.address} ~ '^0x[0-9a-f]{40}$'`)]);


export const registryLookalikeSearches = pgTable("registry_lookalike_searches", {
  chainId: integer("chain_id").notNull(), assetId: text("asset_id").notNull(), symbol: text("symbol").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }), observedAt: timestamp("observed_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }), nextPage: jsonb("next_page"), error: text("error"),
}, (table) => [primaryKey({ columns: [table.chainId, table.assetId] })]);

export const registryLookalikeLocalScan = pgTable("registry_lookalike_local_scan", {
  chainId: integer("chain_id").primaryKey(), afterAddress: text("after_address").notNull().default(""),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const registryLookalikeBeacons = pgTable("registry_lookalike_beacons", {
  chainId: integer("chain_id").notNull(), address: text("address").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }), checkedAt: timestamp("checked_at", { withTimezone: true }),
  error: text("error"),
}, (table) => [primaryKey({ columns: [table.chainId, table.address] })]);
