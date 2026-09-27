import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import type { ProviderId } from "@/lib/agent/selection";

export function providerSettingKey(provider: ProviderId): string {
  return `build.provider.${provider}.enabled`;
}

export async function providerIntegrationEnabled(provider: ProviderId): Promise<boolean> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, providerSettingKey(provider))).limit(1);
  return row === undefined || row.value === "1";
}
