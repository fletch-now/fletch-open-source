ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "verified_at" timestamp;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "verify_error" text;
