// GET /api/v1/projects — every project this account owns, with its build count.
// Reuses lib/build/history.ts's listProjectsWithCounts, the same query the
// dashboard's projects list renders from.

import { authenticateV1, errorJson, isV1Error, json } from "@/lib/auth/v1";
import { listProjectsWithCounts } from "@/lib/build/history";

export async function GET(request: Request): Promise<Response> {
  const actor = await authenticateV1(request, "projects:read");
  if (isV1Error(actor)) {
    return errorJson(actor);
  }
  const projects = await listProjectsWithCounts(actor.userId);
  return json(200, { projects });
}
