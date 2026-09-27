CREATE INDEX "build_logs_build_id_seq_idx" ON "build_logs" USING btree ("build_id","seq");--> statement-breakpoint
CREATE INDEX "builds_user_id_idx" ON "builds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "builds_status_idx" ON "builds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contracts_build_id_idx" ON "contracts" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "credit_events_user_id_idx" ON "credit_events" USING btree ("user_id");