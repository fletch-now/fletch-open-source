"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { adminPasswordConfigured, lockAdmin, unlockAdmin, verifyAdminPassword } from "@/lib/admin/gate";
import { getSession } from "@/lib/dal";
import { checkAdminUnlockRate, clientIp } from "@/lib/ratelimit";

export interface UnlockResult {
  error: string;
}

export async function unlockAdminAction(_prev: UnlockResult | null, formData: FormData): Promise<UnlockResult> {
  if (!adminPasswordConfigured()) {
    return { error: "No admin password is set on this server. Set ADMIN_PASSWORD_HASH and restart." };
  }
  const ip = clientIp(await headers());
  const session = await getSession();
  const userId = session?.user.id ?? null;
  const rate = await checkAdminUnlockRate(ip);
  if (!rate.ok) {
    await recordAudit({ userId, actorType: "user", action: "admin.unlock.throttled", metadata: { ip } });
    return { error: rate.reason ?? "Too many attempts." };
  }
  const password = String(formData.get("password") ?? "");
  if (!(await verifyAdminPassword(password))) {
    await recordAudit({ userId, actorType: "user", action: "admin.unlock.failed", metadata: { ip } });
    return { error: "That password is not right." };
  }
  await unlockAdmin();
  await recordAudit({ userId, actorType: "user", action: "admin.unlock", metadata: { ip } });
  redirect("/trafalgar");
}

export async function lockAdminAction(): Promise<void> {
  const session = await getSession();
  await lockAdmin();
  await recordAudit({ userId: session?.user.id ?? null, actorType: "user", action: "admin.lock" });
  redirect("/");
}
