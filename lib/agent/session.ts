import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";

// Native session reuse is optional. A fresh session receives the portable
// project conversation, including when a failed turn cannot be resumed safely.
export async function priorSessionId(projectId: string | null, buildId: string): Promise<string | undefined> {
  if (!projectId) return undefined;
  const [current] = await db.select().from(builds).where(and(eq(builds.id, buildId), eq(builds.projectId, projectId)));
  if (!current?.billingMode || current.provider !== "kimi" || !current.model) return undefined;
  const [previous] = await db.select().from(builds).where(and(
    eq(builds.projectId, projectId), eq(builds.userId, current.userId), isNotNull(builds.startedAt),
    sql`(${builds.createdAt},${builds.id}) < (${current.createdAt},${current.id})`,
  )).orderBy(desc(builds.createdAt), desc(builds.id)).limit(1);
  if (!previous || previous.status !== "succeeded" || previous.provider !== current.provider ||
      previous.model !== current.model || previous.billingMode !== current.billingMode ||
      previous.custodyMode !== current.custodyMode || previous.credentialId !== current.credentialId ||
      previous.credentialVersion !== current.credentialVersion) return undefined;
  return previous.agentSessionId ?? undefined;
}
