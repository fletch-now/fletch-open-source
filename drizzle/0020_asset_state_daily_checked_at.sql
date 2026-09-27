-- When each figure in a day's row was last read. A daily row used to copy every
-- column of registry_asset_state whether or not it had been read that day, so a
-- stalled writer — or a pool that stopped being priced — had its last answer
-- recorded as every following day's reading. The snapshot now writes a figure
-- only when its writer read it that day, and these columns say when that was.
ALTER TABLE "asset_state_daily" ADD COLUMN IF NOT EXISTS "state_checked_at" timestamp;
ALTER TABLE "asset_state_daily" ADD COLUMN IF NOT EXISTS "feed_checked_at" timestamp;
ALTER TABLE "asset_state_daily" ADD COLUMN IF NOT EXISTS "api_checked_at" timestamp;
ALTER TABLE "asset_state_daily" ADD COLUMN IF NOT EXISTS "dex_checked_at" timestamp;
ALTER TABLE "asset_state_daily" ADD COLUMN IF NOT EXISTS "blockscout_checked_at" timestamp;

GRANT SELECT, INSERT, UPDATE, DELETE ON "asset_state_daily" TO fletch;
