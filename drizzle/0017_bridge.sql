-- Token bridge flows and L1 escrow per bridged asset.
CREATE TABLE IF NOT EXISTS "bridge_flows" (
  "id" text PRIMARY KEY NOT NULL,
  "chain_id" integer NOT NULL,
  "direction" text NOT NULL,
  "l1_token" text NOT NULL,
  "asset_id" text,
  "from_address" text NOT NULL,
  "to_address" text NOT NULL,
  "amount_raw" numeric NOT NULL,
  "l2_to_l1_id" numeric,
  "block_number" bigint NOT NULL,
  "tx_hash" text NOT NULL,
  "log_index" integer NOT NULL,
  "occurred_at" timestamp NOT NULL,
  "claimable_at" timestamp
);
CREATE INDEX IF NOT EXISTS "bridge_flows_asset_idx" ON "bridge_flows" ("asset_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "bridge_flows_chain_idx" ON "bridge_flows" ("chain_id", "occurred_at");

CREATE TABLE IF NOT EXISTS "bridge_escrow" (
  "asset_id" text PRIMARY KEY NOT NULL,
  "chain_id" integer NOT NULL,
  "l1_token" text NOT NULL,
  "l1_gateway" text NOT NULL,
  "escrow_raw" numeric NOT NULL,
  "l2_supply_raw" numeric,
  "in_flight_raw" numeric,
  "checked_at" timestamp DEFAULT now() NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON "bridge_flows", "bridge_escrow" TO fletch;
