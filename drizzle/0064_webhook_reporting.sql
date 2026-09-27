-- Additive and compatible with retained web/worker generations. Historical
-- combined test/alert timestamps cannot be classified, so these start null.
SET lock_timeout = '5s';
ALTER TABLE webhook_endpoints
  ADD COLUMN IF NOT EXISTS last_test_at timestamp,
  ADD COLUMN IF NOT EXISTS last_test_status integer,
  ADD COLUMN IF NOT EXISTS last_test_error text,
  ADD COLUMN IF NOT EXISTS last_alert_at timestamp,
  ADD COLUMN IF NOT EXISTS last_alert_status integer,
  ADD COLUMN IF NOT EXISTS last_alert_error text;
