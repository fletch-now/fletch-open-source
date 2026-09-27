import { isImageAttachment } from "@/lib/build/attachments";
import { validateAttachments } from "@/lib/build/attachment-images";
import { gatewayActive, listGateways } from "@/lib/agent/gateway";
import { providerIntegrationEnabled } from "@/lib/agent/provider-settings";
import { revokeCredentialLeases } from "@/lib/agent/lease-revocation";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds, modelGateways, userModelKeys } from "@/lib/db/schema";
import { decryptCredential, encryptCredential } from "@/lib/agent/credential-secret";
import { platformProvider, userProvider, type ProviderConfig } from "@/lib/agent/provider";
import { BuildSelectionError, defaultModel, modelCapabilities, isProviderId, TEXT_CAPABILITIES, validModel, type BuildSelection, type ModelCapabilities, type ProviderId } from "@/lib/agent/selection";
export { isProviderId } from "@/lib/agent/selection";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export interface StoredModelKey {
  id: string;
  version: number;
  provider: ProviderId;
  model: string;
  keyPrefix: string;
  custodyMode: "hosted" | "gateway";
  validationStatus: string;
  validatedAt: Date | null;
  capabilities: ModelCapabilities;
  createdAt: Date;
  lastUsedAt: Date | null;
}
export async function listModelKeys(userId: string): Promise<StoredModelKey[]> {
  const rows = await db.select({ id: userModelKeys.id, version: userModelKeys.version,
    provider: userModelKeys.provider, model: userModelKeys.model, keyPrefix: userModelKeys.keyPrefix,
    validationStatus: userModelKeys.validationStatus, validatedAt: userModelKeys.validatedAt,
    createdAt: userModelKeys.createdAt, lastUsedAt: userModelKeys.lastUsedAt,
  }).from(userModelKeys).where(and(eq(userModelKeys.userId, userId), isNull(userModelKeys.revokedAt))).orderBy(userModelKeys.createdAt);
  const hosted: StoredModelKey[] = rows.filter((row) => isProviderId(row.provider)).map(function metadata(row) {
    const provider = row.provider as ProviderId;
    return { ...row, provider, model: row.model ?? defaultModel(provider), custodyMode: "hosted", capabilities: modelCapabilities(provider, row.model ?? defaultModel(provider)) };
  });
  return [...hosted, ...await listGateways(userId)];
}
function identity(userId: string, provider: string, id: string, version: number): string {
  return JSON.stringify([userId, provider, id, version]);
}
export async function saveModelKey(userId: string, provider: ProviderId, apiKey: string, model: string | null): Promise<void> {
  const selectedModel = model ?? defaultModel(provider);
  if (!validModel(selectedModel)) throw new BuildSelectionError("Choose a valid model ID.");
  const savedId = await db.transaction(async function save(tx) {
    await tx.execute(sql`select id from "user" where id = ${userId} for update`);
    const [previous] = await tx.select().from(userModelKeys).where(and(eq(userModelKeys.userId, userId), eq(userModelKeys.provider, provider)));
    const id = previous?.id ?? `mk_${randomUUID()}`;
    const version = (previous?.version ?? 0) + 1;
    const values = { id, userId, provider, version, model: selectedModel,
      keyPrefix: createHash("sha256").update(apiKey).digest("hex").slice(0, 12),
      encryptedKey: encryptCredential(apiKey, identity(userId, provider, id, version)),
      createdAt: new Date(), lastUsedAt: null, revokedAt: null, validationStatus: "unvalidated", validatedAt: null };
    await tx.insert(userModelKeys).values(values).onConflictDoUpdate({ target: [userModelKeys.userId, userModelKeys.provider], set: values });
    return id;
  });
  revokeCredentialLeases(savedId);
}
export async function deleteModelKey(userId: string, provider: ProviderId): Promise<boolean> {
  const ids = await db.transaction(async function revoke(tx) {
    await tx.execute(sql`select id from "user" where id = ${userId} for update`);
    return tx.update(userModelKeys).set({ revokedAt: new Date(), encryptedKey: "", validationStatus: "revoked" })
      .where(and(eq(userModelKeys.userId, userId), eq(userModelKeys.provider, provider))).returning({ id: userModelKeys.id });
  });
  for (const row of ids) revokeCredentialLeases(row.id);
  return true;
}
export interface ExecutionSnapshot {
  billingMode: "platform" | "own_key";
  custodyMode: "platform" | "hosted" | "gateway";
  provider: ProviderId;
  model: string;
  credentialId: string | null;
  credentialVersion: number | null;
  capabilities: ModelCapabilities;
}
// The caller holds the account lock, which key rotation and revocation also acquire.
export async function snapshotSelection(tx: Transaction, userId: string, selection: BuildSelection): Promise<ExecutionSnapshot> {
  const providerId = selection.billingMode === "platform" ? "kimi" : selection.provider;
  if (!await providerIntegrationEnabled(providerId)) throw new BuildSelectionError("The selected provider integration is paused.");
  if (selection.billingMode === "platform") {
    const provider = platformProvider();
    if (!provider) throw new BuildSelectionError("Fletch's model is unavailable. Connect and select your own model key.");
    return { billingMode: "platform", custodyMode: "platform", provider: provider.id, model: provider.model,
      credentialId: null, credentialVersion: null, capabilities: modelCapabilities(provider.id, provider.model, "platform") };
  }
  if (selection.custodyMode === "gateway") {
    const [gateway] = await tx.select().from(modelGateways).where(and(eq(modelGateways.id, selection.credentialId), eq(modelGateways.userId, userId), isNull(modelGateways.revokedAt)));
    if (!gateway?.pairedAt || gateway.version !== selection.credentialVersion || gateway.provider !== selection.provider || gateway.model !== selection.model) throw new BuildSelectionError("Reconnect your selected gateway and submit a new build.");
    return { billingMode: "own_key", custodyMode: "gateway", provider: selection.provider, model: selection.model, credentialId: gateway.id, credentialVersion: gateway.version, capabilities: TEXT_CAPABILITIES };
  }
  const [row] = await tx.select().from(userModelKeys).where(and(eq(userModelKeys.id, selection.credentialId), eq(userModelKeys.userId, userId), isNull(userModelKeys.revokedAt)));
  if (!row || row.version !== selection.credentialVersion || row.provider !== selection.provider ||
      (row.model ?? defaultModel(selection.provider)) !== selection.model || !validModel(selection.model)) throw new BuildSelectionError();
  return { billingMode: "own_key", custodyMode: "hosted", provider: selection.provider, model: selection.model,
    credentialId: row.id, credentialVersion: row.version, capabilities: modelCapabilities(selection.provider, selection.model) };
}
export async function credentialStillActive(provider: ProviderConfig): Promise<boolean> {
  if (!provider.bringYourOwnKey) return true;
  if (provider.gatewayId && provider.ownerId) return gatewayActive(provider.gatewayId, provider.ownerId, provider.credentialVersion ?? 1);
  if (!provider.credentialId || !provider.ownerId || !provider.credentialVersion) return false;
  const [row] = await db.select({ id: userModelKeys.id }).from(userModelKeys).where(and(
    eq(userModelKeys.id, provider.credentialId), eq(userModelKeys.userId, provider.ownerId),
    eq(userModelKeys.version, provider.credentialVersion), isNull(userModelKeys.revokedAt)));
  return Boolean(row);
}
export async function providerForBuild(userId: string, buildId: string): Promise<ProviderConfig> {
  const [build] = await db.select().from(builds).where(and(eq(builds.id, buildId), eq(builds.userId, userId)));
  if (!build?.billingMode || !build.model) throw new BuildSelectionError("This legacy queued build has no saved model selection. Submit a new build.");
  const references = (await validateAttachments(build.attachments ?? [])).filter(isImageAttachment);
  if (references.length && !build.capabilities?.images) throw new BuildSelectionError("This saved build does not support image input. Select a vision-capable model and submit a new build.");
  const imageConfig = { referenceImages: references, capabilities: build.capabilities ?? TEXT_CAPABILITIES };
  if (!await providerIntegrationEnabled(build.provider)) throw new BuildSelectionError("The selected provider integration is paused.");
  if (build.billingMode === "platform") {
    const configured = platformProvider();
    if (!configured || configured.id !== build.provider) throw new BuildSelectionError("Fletch's selected model is unavailable.");
    return { ...configured, ...imageConfig, model: build.model, buildId, ownerId: userId };
  }
  if (!build.credentialId || !build.credentialVersion || !isProviderId(build.provider)) throw new BuildSelectionError();
  if (build.custodyMode === "gateway") {
    if (!await gatewayActive(build.credentialId, userId, build.credentialVersion)) throw new BuildSelectionError("Reconnect your selected gateway and submit a new build.");
    return { ...userProvider(build.provider, "", build.model), ...imageConfig, gatewayId: build.credentialId, credentialId: build.credentialId, credentialVersion: build.credentialVersion, ownerId: userId, buildId };
  }
  const [row] = await db.select().from(userModelKeys).where(and(eq(userModelKeys.id, build.credentialId), eq(userModelKeys.userId, userId),
    eq(userModelKeys.version, build.credentialVersion), eq(userModelKeys.provider, build.provider), isNull(userModelKeys.revokedAt)));
  if (!row || !row.encryptedKey) throw new BuildSelectionError();
  let apiKey: string;
  try { apiKey = decryptCredential(row.encryptedKey, identity(userId, row.provider, row.id, row.version)); }
  catch { throw new BuildSelectionError("The selected key cannot be unlocked. Reconnect it in Settings."); }
  await db.update(userModelKeys).set({ lastUsedAt: new Date() }).where(and(eq(userModelKeys.id, row.id), eq(userModelKeys.version, row.version)));
  return { ...userProvider(build.provider, apiKey, build.model), ...imageConfig, credentialId: row.id, credentialVersion: row.version, ownerId: userId, buildId };
}

export async function validateModelKey(userId: string, credentialId: string): Promise<string> {
  const [row] = await db.select().from(userModelKeys).where(and(eq(userModelKeys.id, credentialId), eq(userModelKeys.userId, userId), isNull(userModelKeys.revokedAt)));
  if (!row || !isProviderId(row.provider)) throw new BuildSelectionError();
  let status = "unavailable";
  try {
    const key = decryptCredential(row.encryptedKey, identity(userId, row.provider, row.id, row.version));
    const provider = userProvider(row.provider, key, row.model ?? undefined);
    const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
    if (row.provider === "anthropic") { delete headers.Authorization; headers["x-api-key"] = key; headers["anthropic-version"] = "2023-06-01"; }
    const suffix = row.provider === "kimi" ? "/models" : `/models/${encodeURIComponent(provider.model)}`;
    const response = await fetch(`${provider.baseUrl}${suffix}`, { headers, redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (response.ok) {
      const body = await response.json() as { id?: string; data?: Array<{ id?: string }> };
      status = body.id === provider.model || body.data?.some((model) => model.id === provider.model) ? "accessible" : "model_unavailable";
    } else if (response.status === 401 || response.status === 403) status = "unauthorized";
    else if (response.status === 404) status = "model_unavailable";
    else if (response.status === 429) status = "rate_limited";
    await response.body?.cancel().catch(() => undefined);
  } catch { status = "unavailable"; }
  await db.update(userModelKeys).set({ validationStatus: status, validatedAt: new Date() }).where(and(
    eq(userModelKeys.id, row.id), eq(userModelKeys.version, row.version), isNull(userModelKeys.revokedAt)));
  return status;
}
