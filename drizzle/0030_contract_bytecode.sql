-- Creation bytecode per deployed contract, for wallet-signed mainnet deploys.
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "bytecode" text;
