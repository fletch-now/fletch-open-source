-- A watcher may target any address on the chain, not only a registry asset.
-- unverified_ack records that the person was told the contract did not answer
-- as an ERC-20 and asked for the watcher anyway.
ALTER TABLE watchers ADD COLUMN IF NOT EXISTS unverified_ack boolean NOT NULL DEFAULT false;
GRANT ALL ON TABLE watchers TO fletch;
