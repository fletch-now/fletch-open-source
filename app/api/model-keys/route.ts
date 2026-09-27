// A person's own model key. The key itself is written once and never read back:
// GET returns the provider, the model and the first few characters, which tells
// two keys apart without handing either one over.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { deleteModelKey, isProviderId, listModelKeys, saveModelKey, validateModelKey } from "@/lib/agent/user-keys";

import { guardKeyMutation, readKeyBody } from "@/lib/agent/key-api";
import { platformProvider } from "@/lib/agent/provider";
import { providerIntegrationEnabled } from "@/lib/agent/provider-settings";
import { BuildSelectionError, modelCapabilities } from "@/lib/agent/selection";

const SaveKeySchema = z.object({
  provider: z.enum(["kimi", "openai", "anthropic"]),
  custodyMode: z.literal("hosted"),
  apiKey: z.string().trim().min(16).max(512).regex(/^[a-zA-Z0-9_.-]+$/),
  model: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/).optional(),
});

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const platform = platformProvider();
  const platformMetadata = platform ? { provider: platform.id, model: platform.model, capabilities: modelCapabilities(platform.id, platform.model, "platform"), available: await providerIntegrationEnabled(platform.id) } : null;
  return NextResponse.json({ keys: await listModelKeys(session.user.id), platform: platformMetadata });
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const denied = await guardKeyMutation(request, session.user.id);
  if (denied) return denied;
  const parsed = SaveKeySchema.safeParse(await readKeyBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Give a provider and a key of at least 16 characters." }, { status: 400 });
  }
  try {
    await saveModelKey(session.user.id, parsed.data.provider, parsed.data.apiKey, parsed.data.model ?? null);
  } catch (error) {
    const message = error instanceof BuildSelectionError ? error.message : "Hosted model storage is unavailable. Contact the operator.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
  await recordAudit({
    userId: session.user.id,
    actorType: "user",
    action: "model_key.save",
    resourceType: "model_key",
    resourceId: parsed.data.provider,
  });
  return NextResponse.json({ keys: await listModelKeys(session.user.id) }, { status: 201 });
}

export async function DELETE(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const denied = await guardKeyMutation(request, session.user.id);
  if (denied) return denied;
  const provider = new URL(request.url).searchParams.get("provider") ?? "";
  if (!isProviderId(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }
  const removed = await deleteModelKey(session.user.id, provider);
  if (!removed) {
    return NextResponse.json({ error: "No key for that provider" }, { status: 404 });
  }
  await recordAudit({ userId: session.user.id, actorType: "user", action: "model_key.delete", resourceType: "model_key", resourceId: provider });
  return NextResponse.json({ keys: await listModelKeys(session.user.id) });
}

export async function PATCH(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const denied = await guardKeyMutation(request, session.user.id);
  if (denied) return denied;
  const parsed = z.object({ credentialId: z.string().min(1).max(100), action: z.literal("validate") }).safeParse(await readKeyBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Choose a connected key to validate." }, { status: 400 });
  try {
    const validationStatus = await validateModelKey(session.user.id, parsed.data.credentialId);
    await recordAudit({ userId: session.user.id, actorType: "user", action: "model_key.validate", resourceType: "model_key", resourceId: parsed.data.credentialId });
    return NextResponse.json({ validationStatus, keys: await listModelKeys(session.user.id) });
  } catch {
    return NextResponse.json({ error: "Reconnect the selected key." }, { status: 404 });
  }
}
