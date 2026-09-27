import { config as loadEnv } from "dotenv";
import type { Config } from "drizzle-kit";

// drizzle-kit auto-loads .env only; the app uses .env.local, so load it here too.
loadEnv({ path: ".env.local" });
loadEnv();

export default {
  schema: ["./lib/db/schema.ts", "./lib/db/build-worker-schema.ts", "./lib/db/build-pricing-schema.ts", "./lib/db/registry-priority-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
} satisfies Config;
