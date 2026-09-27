-- A price per priced pool every few minutes, kept for two days, so a market
-- table can show how far a pool moved over 5 minutes, an hour, six and a day.
CREATE TABLE IF NOT EXISTS dex_price_samples (
  pool_id text NOT NULL,
  at timestamp NOT NULL,
  price_usd numeric NOT NULL,
  PRIMARY KEY (pool_id, at)
);
CREATE INDEX IF NOT EXISTS dex_price_samples_at_idx ON dex_price_samples (at);
GRANT ALL ON TABLE dex_price_samples TO fletch;
