// GET /api/v1/status — the registry's freshness for the one chain it serves,
// so a client that knows nothing about chain ids can still ask "is it live".
// The same body as /api/v1/chains/4663/status.

import { RH_MAINNET_ID } from "@/lib/config";
import { statusResponse } from "@/lib/api/status";

export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(request: Request): Promise<Response> {
  return statusResponse(request, RH_MAINNET_ID);
}
