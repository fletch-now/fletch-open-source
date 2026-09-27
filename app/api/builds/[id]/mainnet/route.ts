import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { mainnetDeploysEnabled } from "@/lib/build/deploy";
import { recordMainnetDeployment } from "@/lib/build/mainnet";
import { checkUserRate } from "@/lib/ratelimit";

// Records a mainnet deployment the person signed from their own wallet: the
// server checks the transaction against the bytecode it compiled, then
// verifies the source and rebuilds the front end. Gated by FORGE_MAINNET_DEPLOYS.

const BodySchema = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

// One recording per build at a time: two at once would race on the
// workspace's dist and the site's release directory.
const inProgress = new Set<string>();

export async function POST(request: Request, ctx: RouteContext<"/api/builds/[id]/mainnet">): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  if (!mainnetDeploysEnabled()) {
    return NextResponse.json({ error: "Mainnet deploys are not open on this server yet." }, { status: 409 });
  }
  const parsed = BodySchema.safeParse(await request.json().catch(function notJson() {
    return null;
  }));
  if (!parsed.success) {
    return NextResponse.json({ error: "Send the transaction hash as { txHash }." }, { status: 400 });
  }
  const rate = await checkUserRate(`mainnet:${session.user.id}`);
  if (!rate.ok) {
    return NextResponse.json({ error: "Too many mainnet recordings; try again in a while." }, { status: 429 });
  }
  const { id } = await ctx.params;
  if (inProgress.has(id)) {
    return NextResponse.json({ error: "A mainnet recording for this build is already in progress." }, { status: 409 });
  }
  inProgress.add(id);
  let result: Awaited<ReturnType<typeof recordMainnetDeployment>>;
  try {
    result = await recordMainnetDeployment({ buildId: id, userId: session.user.id, txHash: parsed.data.txHash as `0x${string}` });
  } finally {
    inProgress.delete(id);
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }
  await recordAudit({ userId: session.user.id, actorType: "user", action: "build.mainnet", resourceType: "build", resourceId: id });
  return NextResponse.json(result);
}
