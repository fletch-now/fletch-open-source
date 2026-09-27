"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { savePricingDraft, publishPricingDraft } from "@/lib/admin/pricing";

export interface PricingActionState { ok: boolean; message: string; draftId?: string }

export async function saveDraft(_previous: PricingActionState | null, form: FormData): Promise<PricingActionState> {
  const admin = await requireAdmin();
  try {
    const draft = await savePricingDraft(admin, JSON.parse(String(form.get("policy"))), String(form.get("draftId") || "") || null, Number(form.get("revision") || 0));
    revalidatePath("/trafalgar/pricing");
    return { ok: true, message: "Draft saved. Preview the exact package terms before publishing.", draftId: draft.id };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Could not save draft." }; }
}

export async function publishDraft(_previous: PricingActionState | null, form: FormData): Promise<PricingActionState> {
  const admin = await requireAdmin();
  try {
    await publishPricingDraft(admin, { id: String(form.get("draftId")), revision: Number(form.get("revision")), digest: String(form.get("digest")), expectedActive: String(form.get("active") || "") || null, reason: String(form.get("reason") || "") });
    revalidatePath("/trafalgar/pricing");revalidatePath("/pricing");
    return { ok: true, message: "Published. Existing accepted builds and unexpired quotes keep their terms." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Could not publish draft." }; }
}
