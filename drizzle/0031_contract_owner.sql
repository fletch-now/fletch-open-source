-- The owner wallet each deployed contract was constructed with.
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "owner_address" text;
