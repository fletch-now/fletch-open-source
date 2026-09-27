import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

// Every sensitive mutation leaves a row: who did what to which resource. Reads do
// not. The row is written after the action succeeds, inside the same request.

export type ActorType = "user" | "api_key" | "system";

export interface AuditEntry {
  userId: string | null;
  actorType: ActorType;
  actorId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    id: `al_${randomUUID()}`,
    userId: entry.userId,
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    resourceType: entry.resourceType ?? null,
    resourceId: entry.resourceId ?? null,
    metadata: entry.metadata ?? null,
  });
}
