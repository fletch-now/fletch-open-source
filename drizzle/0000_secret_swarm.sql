CREATE TYPE "public"."abuse_verdict" AS ENUM('allow', 'queue_low', 'deny');--> statement-breakpoint
CREATE TYPE "public"."build_provider" AS ENUM('anthropic', 'kimi');--> statement-breakpoint
CREATE TYPE "public"."build_status" AS ENUM('queued', 'provisioning', 'building', 'compiling', 'deploying', 'exporting', 'succeeded', 'failed', 'killed');--> statement-breakpoint
CREATE TYPE "public"."credit_reason" AS ENUM('free_grant', 'build_debit', 'refund', 'admin_adjust', 'purchase');--> statement-breakpoint
CREATE TYPE "public"."deployer" AS ENUM('platform', 'user');--> statement-breakpoint
CREATE TABLE "abuse_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"wallet" text,
	"device_hash" text,
	"ip_hash" text,
	"turnstile_score" numeric,
	"wallet_age_days" integer,
	"wallet_tx_count" integer,
	"verdict" "abuse_verdict" DEFAULT 'allow' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"build_id" text NOT NULL,
	"seq" integer NOT NULL,
	"level" text,
	"chunk" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "builds" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"user_id" text NOT NULL,
	"prompt" text NOT NULL,
	"provider" "build_provider" DEFAULT 'kimi' NOT NULL,
	"model" text,
	"status" "build_status" DEFAULT 'queued' NOT NULL,
	"trigger_run_id" text,
	"sandbox_id" text,
	"token_budget" integer,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" numeric,
	"error" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"build_id" text NOT NULL,
	"chain_id" integer NOT NULL,
	"address" text NOT NULL,
	"tx_hash" text,
	"abi" jsonb,
	"source_hash" text,
	"verified" boolean DEFAULT false,
	"deployer" "deployer" DEFAULT 'platform' NOT NULL,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" "credit_reason" NOT NULL,
	"build_id" text,
	"external_ref" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text,
	"role" text,
	"tailscale_hostname" text,
	"status" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"template" text,
	"cf_dispatch_script_id" text,
	"source_r2_key" text,
	"preview_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_address" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "abuse_signals" ADD CONSTRAINT "abuse_signals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_logs" ADD CONSTRAINT "build_logs_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_events" ADD CONSTRAINT "credit_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_address" ADD CONSTRAINT "wallet_address_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_events_idempotency_key_idx" ON "credit_events" USING btree ("idempotency_key");