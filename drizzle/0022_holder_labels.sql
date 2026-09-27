-- Where the float sits. A holder address on its own is a hex string; the
-- question a reader has is whether the tokens at it are somebody's holding or
-- a place tokens sit — a Uniswap pool, the bridge, the issuer's own wallet,
-- another contract. holder_labels answers that once per address and the daily
-- concentration reading turns it into shares.
--
-- `kind` is one of: pool_manager, dex_pool, issuer, bridge_gateway, locker,
-- contract, exchange, eoa. `eoa` is the cached answer of the code probe when
-- an address has no bytecode: without it every run would re-probe the same
-- tens of thousands of ordinary wallets over a rate-limited RPC.
CREATE TABLE IF NOT EXISTS "holder_labels" (
  "address" text PRIMARY KEY NOT NULL,
  "label" text NOT NULL,
  "kind" text NOT NULL,
  "source" text NOT NULL,
  "first_seen_at" timestamp DEFAULT now() NOT NULL,
  "checked_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "holder_labels_kind_idx" ON "holder_labels" ("kind");

-- The shares that split a supply into where it sits. issuer_pct already
-- existed (the mint wallet); the rest are added, never renamed. unknown_pct is
-- the share held by addresses the code probe has not reached yet, so float_pct
-- is what is left after everything that has been checked rather than a residual
-- that quietly absorbs unlabelled contracts.
ALTER TABLE "asset_concentration" ADD COLUMN IF NOT EXISTS "pools_pct" numeric;
ALTER TABLE "asset_concentration" ADD COLUMN IF NOT EXISTS "bridge_pct" numeric;
ALTER TABLE "asset_concentration" ADD COLUMN IF NOT EXISTS "contracts_pct" numeric;
ALTER TABLE "asset_concentration" ADD COLUMN IF NOT EXISTS "unknown_pct" numeric;
ALTER TABLE "asset_concentration" ADD COLUMN IF NOT EXISTS "float_pct" numeric;

GRANT SELECT, INSERT, UPDATE, DELETE ON "holder_labels" TO fletch;
