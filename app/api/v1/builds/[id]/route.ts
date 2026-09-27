// GET /api/v1/builds/:id — one build's status, deployed contracts, and the
// toolchain's actual verdict (compile/test reports, artifacts), scoped to the
// owner. Mirrors app/api/builds/[id]/route.ts's shape and adds the summary
// lib/build/history.ts's summariseBuild rebuilds from the persisted event log —
// the same "toolchain is the source of truth" summary the build console shows,
// not the model's own description of what it did.

import { eq } from "drizzle-orm";
import { authenticateV1, errorJson, isV1Error, json } from "@/lib/auth/v1";
import { db } from "@/lib/db";
import { builds, contracts, projects } from "@/lib/db/schema";
import { summariseBuild } from "@/lib/build/history";
import { publicationStatus } from "@/lib/hosting/publications";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/v1/builds/[id]">,
): Promise<Response> {
  const actor = await authenticateV1(request, "builds:read");
  if (isV1Error(actor)) {
    return errorJson(actor);
  }
  const { id } = await ctx.params;

  const buildRows = await db.select().from(builds).where(eq(builds.id, id)).limit(1);
  const build = buildRows[0];
  if (!build || build.userId !== actor.userId) {
    return json(404, { error: "Not found" });
  }

  const projectRows = build.projectId
    ? await db.select().from(projects).where(eq(projects.id, build.projectId)).limit(1)
    : [];
  const contractRows = await db.select().from(contracts).where(eq(contracts.buildId, build.id));
  const summary = await summariseBuild(build.id);

  return json(200, {
    build: {
      id: build.id,
      projectId: build.projectId,
      prompt: build.prompt,
      status: build.status,
      billingMode: build.billingMode,
      custodyMode: build.custodyMode,
      provider: build.provider,
      model: build.model,
      capabilities: build.capabilities,
      error: build.error,
      startedAt: build.startedAt,
      finishedAt: build.finishedAt,
      createdAt: build.createdAt,
    },
    previewUrl: projectRows[0]?.previewUrl ?? null,
    publication: build.projectId ? await publicationStatus(actor.userId, build.projectId) : null,
    contracts: contractRows.map(function toContract(row) {
      return { chainId: row.chainId, address: row.address, verified: row.verified, deployer: row.deployer };
    }),
    templateVersion: summary.templateVersion,
    compile: summary.compile,
    tests: summary.tests,
    analysis: summary.analysis,
    artifacts: summary.artifacts,
  });
}
