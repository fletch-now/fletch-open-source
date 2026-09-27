import sharp from "sharp";
import { BuildAttachmentsSchema, isImageAttachment, MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS } from "@/lib/build/attachments";
import type { BuildAttachment, BuildImageAttachment } from "@/lib/build/types";

export class AttachmentError extends Error {}

// Decode under a pixel limit before storage. The original bytes, never a generated
// description or recompressed copy, go to the selected provider and workspace.
export async function validateAttachments(files: BuildAttachment[]): Promise<BuildAttachment[]> {
  const parsed = BuildAttachmentsSchema.safeParse(files);
  if (!parsed.success) throw new AttachmentError(parsed.error.issues[0]?.message ?? "Attach valid PNG/JPEG images or text files.");
  for (const file of parsed.data) {
    if (!isImageAttachment(file)) continue;
    const bytes = Buffer.from(file.data, "base64");
    if (bytes.toString("base64") !== file.data) throw new AttachmentError("The image upload is incomplete. Attach it again.");
    if (!matchesSignature(bytes, file)) throw new AttachmentError("The image contents do not match its PNG/JPEG type.");
    try {
      const decoder = sharp(bytes, { failOn: "warning", limitInputPixels: MAX_IMAGE_PIXELS });
      const metadata = await decoder.metadata();
      const expected = file.mediaType === "image/png" ? "png" : "jpeg";
      if (metadata.format !== expected || !metadata.width || !metadata.height || metadata.width > MAX_IMAGE_EDGE || metadata.height > MAX_IMAGE_EDGE || (metadata.pages ?? 1) !== 1) {
        throw new AttachmentError("Use a still PNG/JPEG image no larger than 4096 pixels per side and 16 megapixels.");
      }
      await decoder.raw().toBuffer();
    } catch (error) {
      if (error instanceof AttachmentError) throw error;
      throw new AttachmentError("That image is damaged or too large to decode. Use a PNG/JPEG under 4096 pixels per side and 16 megapixels.");
    }
  }
  return parsed.data;
}
function matchesSignature(bytes: Buffer, image: BuildImageAttachment): boolean {
  if (image.mediaType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}
