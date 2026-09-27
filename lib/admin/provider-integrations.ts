import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { modelGateways, userModelKeys } from "@/lib/db/schema";
import { providerIntegrationEnabled } from "@/lib/agent/provider-settings";
import type { ProviderId } from "@/lib/agent/selection";

interface Integration {
  provider: ProviderId;
  enabled: boolean;
  connected: number;
  validated: number;
  gateways: number;
  onlineGateways: number;
}

export async function providerIntegrations(): Promise<Integration[]> {
  const counts = await db.select({ provider: userModelKeys.provider, connected: sql<number>`count(*)::int`,
    validated: sql<number>`count(*) filter (where ${eq(userModelKeys.validationStatus, "accessible")})::int`,
  }).from(userModelKeys).where(isNull(userModelKeys.revokedAt)).groupBy(userModelKeys.provider);
  const gateways = await db.select({ provider: modelGateways.provider, count: sql<number>`count(*)::int`,
    online: sql<number>`count(*) filter (where ${modelGateways.lastSeenAt} > now() - interval '60 seconds')::int`,
  }).from(modelGateways).where(and(isNull(modelGateways.revokedAt), isNotNull(modelGateways.pairedAt))).groupBy(modelGateways.provider);
  return Promise.all((["openai", "anthropic", "kimi"] as const).map(async function status(provider) {
    const count = counts.find((row) => row.provider === provider);
    const gateway = gateways.find((row) => row.provider === provider);
    return { gateways: gateway?.count ?? 0, onlineGateways: gateway?.online ?? 0, provider, enabled: await providerIntegrationEnabled(provider), connected: count?.connected ?? 0, validated: count?.validated ?? 0 };
  }));
}
