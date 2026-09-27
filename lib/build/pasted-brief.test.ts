import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentLimit, isLongPaste, pastedBrief, textBytes } from "@/lib/build/pasted-brief";

test("long paste uses logical lines or long wrapped text, preserving exact contents", function boundary() {
  assert.equal(isLongPaste("a\nb\nc\nd\ne"), false);
  const text = "α\r\nβ\r\nγ\r\nδ\r\nε\r\n最後の行\r\n";
  assert.equal(isLongPaste(text), true);
  assert.equal(pastedBrief(text, []).content, text);
  assert.equal(isLongPaste("a".repeat(601)), true);
  assert.equal(isLongPaste("short instruction"), false);
});

test("pasted briefs never overwrite an existing file and enforce UTF-8 limits", function limits() {
  const files = [{ name: "PASTED-BRIEF.TXT", content: "Original" }, { name: "pasted-brief-2.txt", content: "Second" }];
  assert.equal(pastedBrief("New", files).name, "pasted-brief-3.txt");
  assert.equal(files[0].content, "Original");
  assert.equal(textBytes("€"), 3);
  assert.equal(attachmentLimit([{ name: "brief.txt", content: "a".repeat(64 * 1024) }]), null);
  assert.match(attachmentLimit([{ name: "brief.txt", content: "€".repeat(22_000) }])!, /64 KB/);
  assert.match(attachmentLimit(Array.from({ length: 3 }, (_, i) => ({ name: `${i}.txt`, content: "a".repeat(50_000) })))!, /128 KB/);
  assert.match(attachmentLimit(Array.from({ length: 6 }, (_, i) => ({ name: `${i}.txt`, content: "a" })))!, /five files/);
});
