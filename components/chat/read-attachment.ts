import { BuildAttachmentsSchema, MAX_IMAGE_BYTES, MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS, MAX_TEXT_BYTES } from "@/lib/build/attachments";
import type { BuildAttachment, BuildImageAttachment } from "@/lib/build/types";

function imageData(file: File): Promise<string> {
  return new Promise(function read(resolve, reject) {
    const reader = new FileReader();
    reader.onerror = function failed() { reject(new Error(`Could not read ${file.name}. Attach it again.`)); };
    reader.onload = function loaded() {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export async function readAttachment(file: File): Promise<BuildAttachment> {
  let attachment: BuildAttachment;
  if (/\.(png|jpe?g)$/i.test(file.name) || /^image\/(png|jpeg)$/.test(file.type)) {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} is larger than 2 MB.`);
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) throw new Error(`Could not read ${file.name} as an image.`);
    const tooLarge = bitmap.width > MAX_IMAGE_EDGE || bitmap.height > MAX_IMAGE_EDGE || bitmap.width * bitmap.height > MAX_IMAGE_PIXELS;
    bitmap.close();
    if (tooLarge) throw new Error(`${file.name} exceeds 4096 pixels per side or 16 megapixels.`);
    const mediaType: BuildImageAttachment["mediaType"] = /\.png$/i.test(file.name) || file.type === "image/png" ? "image/png" : "image/jpeg";
    attachment = { kind: "image", name: file.name, mediaType, data: await imageData(file) };
  } else {
    if (file.size > MAX_TEXT_BYTES) throw new Error(`${file.name} is larger than 64 KB.`);
    attachment = { name: file.name, content: await file.text() };
  }
  const parsed = BuildAttachmentsSchema.safeParse([attachment]);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Attach a PNG, JPEG or text file.");
  return attachment;
}
