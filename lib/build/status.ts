import type { builds } from "@/lib/db/schema";

export type BuildStatus = (typeof builds.$inferSelect)["status"];

// A build in one of these states holds a credit and may hold a container. The
// per-account "one at a time" check, the deploy drain, and the admin console all
// need the same answer to "is this build still going".
export const RUNNING_BUILD_STATUSES: BuildStatus[] = ["queued", "provisioning", "building", "compiling", "paused"];

export const FINISHED_BUILD_STATUSES: BuildStatus[] = ["succeeded", "failed", "killed"];
