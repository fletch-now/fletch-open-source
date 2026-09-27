-- Every trust question is "what is at this address": the markets table asks it
-- a hundred times a page, the pool filter asks it once per row in a subquery,
-- and neither table had an index on the address. Without these the lookalike
-- filter is a sequential scan of twenty thousand rows per page.
CREATE INDEX IF NOT EXISTS dex_tokens_address_idx ON dex_tokens (chain_id, address);
CREATE INDEX IF NOT EXISTS lookalike_tokens_address_idx ON lookalike_tokens (chain_id, address);
