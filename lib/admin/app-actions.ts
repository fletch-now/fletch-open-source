"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { ListingError, reviewListing } from "@/lib/apps/directory";
import type { ActionResult } from "./actions";

export async function reviewApp(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = z
    .object({
      projectId: z.string().min(1).max(100),
      version: z.coerce.number().int().min(1),
      action: z.enum([
        "approve",
        "reject",
        "suspend",
        "reopen",
        "feature",
        "unfeature",
      ]),
      note: z.string().trim().max(500),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      ok: false,
      message:
        "Check the review action and keep its note within 500 characters.",
    };
  const { projectId, version, action, note } = parsed.data;
  if ((action === "reject" || action === "suspend") && note.length < 5)
    return { ok: false, message: "Add a short reason for the owner." };
  try {
    await reviewListing(actor, projectId, version, action, note);
  } catch (cause) {
    if (cause instanceof ListingError)
      return { ok: false, message: cause.message };
    throw cause;
  }
  revalidatePath("/trafalgar/apps");
  revalidatePath("/published", "layout");
  return {
    ok: true,
    message:
      "Review saved. Public visibility follows the owner's consent and the approved build.",
  };
}
