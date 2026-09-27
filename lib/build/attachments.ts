import { z } from "zod";
import type { BuildAttachment, BuildImageAttachment } from "@/lib/build/types";

export const MAX_IMAGE_ATTACHMENTS = 3;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGES_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 4096;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_BUILD_BODY_BYTES = 6 * 1024 * 1024;
export const MAX_TEXT_ATTACHMENTS = 5;
export const MAX_TEXT_BYTES = 64 * 1024;
export const MAX_TEXTS_BYTES = 128 * 1024;

export function isImageAttachment(file: BuildAttachment): file is BuildImageAttachment {
  return file.kind === "image";
}
export function attachmentBytes(file: BuildAttachment): number {
  if (!isImageAttachment(file)) return new TextEncoder().encode(file.content).length;
  const padding = file.data.endsWith("==") ? 2 : Number(file.data.endsWith("="));
  return file.data.length * 3 / 4 - padding;
}
const filename = z.string().trim().regex(/^[\w][\w.\- ]{0,63}$/, "Use a file name of up to 64 characters, without a path.");
const text = z.object({
  kind: z.literal("text").optional(),
  name: filename.refine((name) => /\.(md|markdown|txt|csv|json|yml|yaml)$/i.test(name), "Attach a PNG, JPEG or text file: md, txt, csv, json or yaml."),
  content: z.string().refine((value) => new TextEncoder().encode(value).length <= MAX_TEXT_BYTES, "Each text file must be under 64 KB.")
    .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "That file is not text. Attach the original PNG/JPEG image or a text file."),
}).strict();
const image = z.object({
  kind: z.literal("image"),
  name: filename,
  mediaType: z.enum(["image/png", "image/jpeg"]),
  data: z.string().min(4).max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4, "Each image must be under 2 MB.")
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, "The image upload is incomplete. Attach it again."),
}).strict().refine((file) => file.mediaType === "image/png" ? /\.png$/i.test(file.name) : /\.jpe?g$/i.test(file.name), "The image name and PNG/JPEG type must match.");

export const BuildAttachmentsSchema = z.array(z.discriminatedUnion("kind", [image, text])).max(MAX_TEXT_ATTACHMENTS + MAX_IMAGE_ATTACHMENTS)
  .superRefine(function limits(files, context) {
    const images = files.filter(isImageAttachment);
    const texts = files.filter((file) => !isImageAttachment(file));
    const errors: string[] = [];
    if (images.length > MAX_IMAGE_ATTACHMENTS) errors.push("Attach up to three images.");
    if (texts.length > MAX_TEXT_ATTACHMENTS) errors.push("Attach up to five files of text.");
    if (images.some((file) => attachmentBytes(file) > MAX_IMAGE_BYTES)) errors.push("Each image must be under 2 MB.");
    if (images.reduce((sum, file) => sum + attachmentBytes(file), 0) > MAX_IMAGES_BYTES) errors.push("Images must total 4 MB or less.");
    if (texts.reduce((sum, file) => sum + attachmentBytes(file), 0) > MAX_TEXTS_BYTES) errors.push("Text files must total 128 KB or less.");
    if (new Set(files.map((file) => file.name.toLowerCase())).size !== files.length) errors.push("Two files have the same name.");
    for (const message of errors) context.addIssue({ code: "custom", message });
  });
