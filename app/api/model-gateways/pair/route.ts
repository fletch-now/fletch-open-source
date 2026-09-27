import { checkGatewayPairRate, clientIp } from "@/lib/ratelimit";
import { z } from "zod";
import { pairGateway } from "@/lib/agent/gateway";
import { readKeyBody } from "@/lib/agent/key-api";
export async function POST(request: Request): Promise<Response> {
  const rate = await checkGatewayPairRate(clientIp(request.headers));
  if (!rate.ok) return Response.json({ error: rate.reason }, { status: 429 });
  const parsed = z.object({ pairingToken: z.string().min(32).max(100) }).safeParse(await readKeyBody(request));
  if (!parsed.success) return Response.json({ error: "Invalid pairing request" }, { status: 400 });
  const paired = await pairGateway(parsed.data.pairingToken);
  if (!paired) return Response.json({ error: "Pairing token is expired, revoked or already used." }, { status: 401 });
  return Response.json(paired, { headers: { "cache-control": "no-store" } });
}
