-- Production installs these indexes concurrently before deploying search readers.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS dex_tokens_search_symbol_idx ON dex_tokens USING gin (lower(symbol) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS dex_tokens_search_name_idx ON dex_tokens USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS lookalike_search_symbol_idx ON lookalike_tokens USING gin (lower(symbol) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS lookalike_search_name_idx ON lookalike_tokens USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS explorer_candidates_search_symbol_idx ON registry_explorer_candidates USING gin (lower(reported_symbol) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS explorer_candidates_search_name_idx ON registry_explorer_candidates USING gin (lower(reported_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS dex_tokens_search_address_idx ON dex_tokens (chain_id, address text_pattern_ops);
CREATE INDEX IF NOT EXISTS lookalike_search_address_idx ON lookalike_tokens (chain_id, address text_pattern_ops);
CREATE INDEX IF NOT EXISTS explorer_candidates_search_address_idx ON registry_explorer_candidates (chain_id, address text_pattern_ops);
CREATE INDEX IF NOT EXISTS dex_pools_search_address_idx ON dex_pools (chain_id, pool_address) WHERE canonical;
