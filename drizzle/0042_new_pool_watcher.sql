-- A watcher that hears about new pools on the whole chain rather than about
-- one token. It has no asset and no address of its own: the chain is the
-- target, so `address` carries the venue's factory for the explorer link.
ALTER TYPE watcher_kind ADD VALUE IF NOT EXISTS 'new_pool';

-- Only pools whose token borrows a listed ticker or name. Off by default,
-- because the whole point of the kind is to see a launch before anyone else.
ALTER TABLE watchers ADD COLUMN IF NOT EXISTS lookalikes_only boolean NOT NULL DEFAULT false;
GRANT ALL ON TABLE watchers TO fletch;
