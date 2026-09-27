import { checkGatewayRelayRate } from "@/lib/ratelimit";
import { z } from "zod";
import { authenticatedGateway, claimGatewayRequest, completeGatewayRequest } from "@/lib/agent/gateway";
import { readKeyBody } from "@/lib/agent/key-api";
async function connection(request: Request): ReturnType<typeof authenticatedGateway> {
  const header = request.headers.get("authorization") ?? "";
  return authenticatedGateway(header.startsWith("Bearer ") ? header.slice(7) : "");
}
export async function GET(request: Request): Promise<Response> {
  const gateway = await connection(request);
  if (!gateway) return Response.json({ error: "Gateway disconnected or revoked." }, { status: 401 });
  const rate = await checkGatewayRelayRate(gateway.id);
  if (!rate.ok) return Response.json({ error: rate.reason }, { status: 429 });
  return Response.json({ request: await claimGatewayRequest(gateway.id) }, { headers: { "cache-control": "no-store" } });
}
export async function POST(request: Request): Promise<Response> {
  const gateway = await connection(request);
  if (!gateway) return Response.json({ error: "Gateway disconnected or revoked." }, { status: 401 });
  const rate = await checkGatewayRelayRate(gateway.id);
  if (!rate.ok) return Response.json({ error: rate.reason }, { status: 429 });
  const parsed = z.object({ id: z.string().uuid(), responseToken: z.string().min(32).max(100), result: z.object({ status: z.number().int().min(200).max(599), body: z.record(z.string(), z.unknown()) }) }).safeParse(await readKeyBody(request, 16 * 1024 * 1024));
  if (!parsed.success) return Response.json({ error: "Invalid or oversized gateway result." }, { status: 400 });
  const accepted = await completeGatewayRequest(gateway.id, parsed.data.id, parsed.data.responseToken, parsed.data.result);
  return Response.json({ accepted }, { status: accepted ? 200 : 409 });
}
