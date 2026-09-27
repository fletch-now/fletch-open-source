-- Production installs this index CONCURRENTLY before deploying the reader.
CREATE INDEX IF NOT EXISTS dex_tokens_discoveries_idx
  ON dex_tokens (chain_id, first_seen_at DESC, address)
  WHERE NOT hidden AND bytecode_present = true AND checked_at IS NOT NULL
    AND error IS NULL AND symbol IS NOT NULL AND btrim(symbol) <> '';
