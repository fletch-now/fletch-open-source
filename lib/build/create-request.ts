import { z } from "zod";
import { BuildAttachmentsSchema } from "./attachments";
import { MAX_PROMPT_CHARS } from "./prompt-limits";
const MIN_PROMPT_CHARS = 8;
export const CreateBuildSchema = z.object({
  selection: z.discriminatedUnion("billingMode", [
    z.object({ billingMode: z.literal("platform") }),
    z.object({ billingMode: z.literal("own_key"), custodyMode: z.enum(["hosted", "gateway"]).optional(), credentialId: z.string().min(1).max(100),
      credentialVersion: z.number().int().positive(), provider: z.enum(["kimi", "openai", "anthropic"]),
      model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/) }),
  ]).default({ billingMode: "platform" }),
  prompt: z.string().trim().min(MIN_PROMPT_CHARS).max(MAX_PROMPT_CHARS),
  // Present on a follow-up: continue this project instead of starting a new one.
  projectId: z.string().uuid().optional(),
  attachments: BuildAttachmentsSchema.optional(),
  approval: z.object({ quoteId: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().uuid() }).optional(),
});
