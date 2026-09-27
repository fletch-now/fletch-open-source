-- Market cap needs supply that is actually out there. The burn addresses are
-- read on the same pass as total supply, so a token whose deployer burned most
-- of it is not priced as if that supply still existed.
ALTER TABLE dex_tokens ADD COLUMN IF NOT EXISTS burned_raw numeric;
ALTER TABLE dex_tokens ADD COLUMN IF NOT EXISTS supply_checked_at timestamp;
GRANT ALL ON TABLE dex_tokens TO fletch;
