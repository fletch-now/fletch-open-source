"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { saveHolderPolicy } from "@/lib/holder-rewards/admin";
import { HolderReadingError } from "@/lib/holder-rewards/observe";

export interface HolderPolicyActionState { ok: boolean; message: string }

export async function savePolicy(_previous: HolderPolicyActionState | null, form: FormData): Promise<HolderPolicyActionState> {
  const operator = await requireAdmin();
  try {
    const revision = Number(form.get("revision"));
    const rawChain = String(form.get("chainId") ?? "");
    const policy = await saveHolderPolicy({
      revision, enabled: form.get("enabled") === "on", chainId: rawChain ? Number(rawChain) : null,
      tokenAddress: String(form.get("tokenAddress") ?? "").trim() || null,
      referencePoolId: String(form.get("referencePoolId") ?? "").trim() || null,
      period: String(form.get("period") ?? "").trim() || null,
      immediateGrantAccepted: form.get("immediateGrantAccepted") === "on",
      minDepthUsd: String(form.get("minDepthUsd") ?? "25000"),
      maxGrantsPerDay: Number(form.get("maxGrantsPerDay") ?? 100), activatedAt: null,
    }, revision, operator.userId);
    revalidatePath("/trafalgar/holder-credits");
    return { ok: true, message: policy.enabled ? "Holder credits are active. Existing grants remain unchanged." : "Saved with holder credits switched off." };
  } catch (error) {
    return { ok: false, message: error instanceof HolderReadingError ? error.message : "Check the policy fields. No changes were saved." };
  }
}
