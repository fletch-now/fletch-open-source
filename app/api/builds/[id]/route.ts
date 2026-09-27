import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/dal";
import { db } from "@/lib/db";
import { builds, contracts, projects } from "@/lib/db/schema";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/builds/[id]">,
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const buildRows = await db.select().from(builds).where(eq(builds.id, id)).limit(1);
  const build = buildRows[0];
  if (!build || build.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const projectRows = build.projectId
    ? await db.select().from(projects).where(eq(projects.id, build.projectId)).limit(1)
    : [];
  const contractRows = await db.select().from(contracts).where(eq(contracts.buildId, build.id));

  return NextResponse.json({
    build: {
      id: build.id,
      prompt: build.prompt,
      status: build.status,
      createdAt: build.createdAt,
    },
    previewUrl: projectRows[0]?.previewUrl ?? null,
    contracts: contractRows.map(function toContract(row) {
      return { chainId: row.chainId, address: row.address, verified: row.verified, deployer: row.deployer };
    }),
  });
}
