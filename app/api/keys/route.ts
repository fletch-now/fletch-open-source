import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { API_KEY_SCOPES, createApiKey, listApiKeys } from "@/lib/auth/api-keys";

// Key management is session-only: an API key must never be able to mint or list
// other API keys for the account it belongs to.
const CreateApiKeySchema = z.object({
  name: z.string().trim().min(1).max(64),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
});

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const keys = await listApiKeys(session.user.id);
  return NextResponse.json({ keys });
}

export async function POST(request: NextRequest): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }

  const body = await request.json().catch(function ignore() {
    return null;
  });
  const parsed = CreateApiKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid API key request" }, { status: 400 });
  }

  const userId = session.user.id;
  const created = await createApiKey(userId, parsed.data.name, parsed.data.scopes);
  await recordAudit({
    userId,
    actorType: "user",
    action: "api_key.create",
    resourceType: "api_key",
    resourceId: created.id,
    metadata: { name: parsed.data.name, scopes: parsed.data.scopes },
  });

  // The plaintext token is returned exactly once, here — the row only ever
  // stores its hash, so this response is the caller's only chance to see it.
  return NextResponse.json({ id: created.id, token: created.token, prefix: created.prefix }, { status: 201 });
}
