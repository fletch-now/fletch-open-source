import { z } from "zod";
import { getSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { guardKeyMutation, readKeyBody } from "@/lib/agent/key-api";
import { createGateway, listGateways, revokeGateway } from "@/lib/agent/gateway";

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in" }, { status: 401 });
  return Response.json({ gateways: await listGateways(session.user.id) });
}
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in" }, { status: 401 });
  const denied = await guardKeyMutation(request, session.user.id);
  if (denied) return denied;
  const parsed = z.object({ provider: z.enum(["kimi", "openai", "anthropic"]), model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/), label: z.string().trim().min(1).max(80) }).safeParse(await readKeyBody(request));
  if (!parsed.success) return Response.json({ error: "Choose a provider, model ID and gateway label." }, { status: 400 });
  const pairing = await createGateway(session.user.id, parsed.data.provider, parsed.data.model, parsed.data.label);
  await recordAudit({ userId: session.user.id, actorType: "user", action: "model_gateway.create", resourceType: "model_gateway", resourceId: pairing.id });
  return Response.json({ ...pairing, expiresInSeconds: 600 }, { status: 201, headers: { "cache-control": "no-store" } });
}
export async function DELETE(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in" }, { status: 401 });
  const denied = await guardKeyMutation(request, session.user.id);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (!id || id.length > 100) return Response.json({ error: "Choose a gateway." }, { status: 400 });
  await revokeGateway(session.user.id, id);
  await recordAudit({ userId: session.user.id, actorType: "user", action: "model_gateway.revoke", resourceType: "model_gateway", resourceId: id });
  return Response.json({ gateways: await listGateways(session.user.id) });
}
