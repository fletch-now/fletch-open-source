import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { validateAttachments } from "@/lib/build/attachment-images";
import { BuildAttachmentsSchema, MAX_IMAGE_BYTES } from "@/lib/build/attachments";
import type { BuildImageAttachment } from "@/lib/build/types";

async function fixture(format: "png" | "jpeg" = "png"): Promise<BuildImageAttachment> {
  const bytes = await sharp({ create: { width: 24, height: 16, channels: 3, background: "#a24f16" } }).toFormat(format).toBuffer();
  return { kind: "image", name: `reference.${format}`, mediaType: `image/${format}`, data: bytes.toString("base64") };
}
test("PNG and JPEG decode without changing any image or text bytes", async function originals() {
  const files = [{ name: "brief.txt", content: "Full\nbrief €" }, await fixture(), await fixture("jpeg")];
  assert.deepEqual(await validateAttachments(files), files);
});
test("reject paths, MIME spoofing, corrupt files and noncanonical base64", async function invalid() {
  const image = await fixture();
  for (const name of ["../x.png", "/tmp/x.png", "x\\x.png", "x.svg", "x.png\u0000"]) {
    await assert.rejects(validateAttachments([{ ...image, name }]));
  }
  await assert.rejects(validateAttachments([{ ...image, mediaType: "image/jpeg" as const, name: "x.jpg" }]), /match/);
  await assert.rejects(validateAttachments([{ ...image, data: Buffer.from("<svg><script>alert(1)</script></svg>").toString("base64") }]), /match/);
  await assert.rejects(validateAttachments([{ ...image, data: image.data.slice(0, 32) }]), /damaged/);
  await assert.rejects(validateAttachments([{ ...image, data: `${image.data}\n` }]));
  await assert.rejects(validateAttachments([{ ...image, data: `data:image/png;base64,${image.data}` }]));
  await assert.rejects(validateAttachments([{ ...image, data: "AB==" }]), /incomplete/);
});
test("pixel, byte and count bounds apply before model spend", async function bounds() {
  const image = await fixture();
  const wide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(validateAttachments([{ ...image, data: wide.toString("base64") }]), /4096/);
  const bomb = await sharp({ create: { width: 4096, height: 4096, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(validateAttachments([{ ...image, data: bomb.toString("base64") }]), /16 megapixels/);
  assert.equal(BuildAttachmentsSchema.safeParse([{ ...image, data: Buffer.alloc(MAX_IMAGE_BYTES + 1).toString("base64") }]).success, false);
  await assert.rejects(validateAttachments(Array.from({ length: 4 }, (_, i) => ({ ...image, name: `${i}.png` }))), /three images/);
  await assert.rejects(validateAttachments([image, { ...image, name: image.name.toUpperCase() }]), /same name/);
  const texts = Array.from({ length: 5 }, (_, i) => ({ name: `${i}.txt`, content: "brief" }));
  assert.equal((await validateAttachments([...texts, image])).length, 6);
});
