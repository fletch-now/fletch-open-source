"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/dal";
import { pool } from "@/lib/db";
import { MAX_BUILD_CAPACITY, setBuildCapacity } from "@/lib/build/capacity";
import type { ActionResult } from "@/lib/admin/actions";

const CapacityChange = z.object({
  capacity: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).pipe(z.number().int().min(1).max(MAX_BUILD_CAPACITY)),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reviewed: z.boolean(),
  profile: z.enum(["conservative", "shared-experimental"]),
  benchmarkReceipt: z.string().trim().regex(/^[a-f0-9]{64}$/).or(z.literal("")),
  reason: z.string().trim().min(4).max(200),
});

export async function changeBuildCapacity(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = CapacityChange.safeParse({
    capacity: form.get("capacity"),
    expectedFingerprint: form.get("expectedFingerprint"),
    reviewed: form.get("reviewed") === "on",
    profile: form.get("profile") ?? "conservative",
    benchmarkReceipt: form.get("benchmarkReceipt") ?? "",
    reason: form.get("reason"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Choose a policy, enter a whole-number limit from 1 to 100 and a reason of 4 to 200 characters. A benchmark receipt must be a SHA-256 hash. Refresh if the resource reading has changed." };
  }
  const client = await pool.connect();
  let capacity: number;
  try {
    await client.query("begin");
    const updated = await setBuildCapacity(client, parsed.data, { userId: admin.userId, name: admin.name });
    await client.query("commit");
    capacity = updated.current;
  } catch (cause) {
    await client.query("rollback");
    return { ok: false, message: cause instanceof Error ? cause.message : "The build limit could not be saved. Refresh and try again." };
  } finally {
    client.release();
  }
  revalidatePath("/trafalgar/system");
  return { ok: true, message: `Build limit saved: ${capacity}. Running builds keep their progress; new starts follow this limit.` };
}
