import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeAttachments } from "@/lib/build/write-attachments";

test("image bytes stay intact and brief symlinks cannot overwrite host files", async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "fletch-image-write-"));
  const outside = await mkdtemp(join(tmpdir(), "fletch-image-outside-"));
  const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  const image = { kind: "image" as const, name: "reference.png", mediaType: "image/png" as const, data };
  try {
    await writeFile(join(outside, "reference.png"), "keep original");
    await symlink(outside, join(root, "brief"));
    assert.deepEqual(await writeAttachments(root, [image]), ["brief/reference.png"]);
    assert.equal(await readFile(join(root, "brief/reference.png"), "base64"), data);
    assert.equal(await readFile(join(outside, "reference.png"), "utf8"), "keep original");
    await rm(join(root, "brief/reference.png"));
    await symlink(join(outside, "reference.png"), join(root, "brief/reference.png"));
    await writeAttachments(root, [image, { name: "brief.txt", content: "Preserve €\nfull text" }]);
    assert.equal(await readFile(join(outside, "reference.png"), "utf8"), "keep original");
    assert.equal(await readFile(join(root, "brief/reference.png"), "base64"), data);
    assert.equal(await readFile(join(root, "brief/brief.txt"), "utf8"), "Preserve €\nfull text");
    assert.deepEqual(await writeAttachments(root, [{ ...image, name: "../reference.png" }]), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
