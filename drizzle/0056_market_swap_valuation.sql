-- Add evidence to mined Swap identities; retain all old raw legs and fork history.
ALTER TABLE market_swap_events ADD COLUMN IF NOT EXISTS volume_usd numeric;
ALTER TABLE market_swap_events ADD COLUMN IF NOT EXISTS valuation jsonb;
ALTER TABLE market_swap_events ADD COLUMN IF NOT EXISTS log_data text;
ALTER TABLE market_swap_events ADD COLUMN IF NOT EXISTS log_topics jsonb;
ALTER TABLE market_pool_swap_metrics ADD COLUMN IF NOT EXISTS volume_valuation jsonb;
-- Pricing has its own contiguous history boundary: old raw coverage is not
-- evidence that historical quote reads were performed.
ALTER TABLE market_pool_swap_metrics ADD COLUMN IF NOT EXISTS valued_from_block bigint;
