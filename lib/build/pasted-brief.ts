import { BuildAttachmentsSchema } from "@/lib/build/attachments";
import type { BuildAttachment, BuildTextAttachment } from "@/lib/build/types";

export function isLongPaste(text: string): boolean {
  return text.split(/\r\n|\r|\n/).length > 5 || text.length > 600;
}

export function textBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function attachmentLimit(files: BuildAttachment[]): string | null {
  const parsed = BuildAttachmentsSchema.safeParse(files);
  return parsed.success ? null : parsed.error.issues[0]?.message ?? "Choose valid PNG/JPEG images or text files.";
}

export function pastedBrief(text: string, files: BuildAttachment[]): BuildTextAttachment {
  const names = new Set(files.map((file) => file.name.toLowerCase()));
  let name = "pasted-brief.txt";
  for (let sequence = 2; names.has(name); sequence += 1) name = `pasted-brief-${sequence}.txt`;
  return { name, content: text };
}

export function briefInstruction(name: string): string {
  return `Read brief/${name} in full and use it as the build brief.`;
}
