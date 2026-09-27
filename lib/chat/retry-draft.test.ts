import assert from "node:assert/strict";
import { test } from "node:test";
import { retryDraft } from "./retry-draft";
import type { ChatMessage } from "./types";
import { briefInstruction, pastedBrief } from "../build/pasted-brief";
import { CreateBuildSchema } from "../build/create-request";

function message(id: string, role: ChatMessage["role"], content = ""): ChatMessage {
  return { id, role, content, toolCalls: [], phase: "done" };
}

test("retry restores the persisted pasted brief through the normal build request schema", function () {
  const brief = pastedBrief("Build a read-only tracker.\nShow live swaps and their source.\n".repeat(30), []);
  const prompt = briefInstruction(brief.name);
  const messages: ChatMessage[] = [
    { ...message("original-u", "user", prompt), attachments: [brief] },
    { ...message("original-a", "assistant"), error: "Build failed", canRetry: true },
  ];
  const draft = retryDraft(messages, "original-a");
  assert.ok(draft);
  const request = CreateBuildSchema.parse(JSON.parse(JSON.stringify({
    ...draft,
    projectId: "11111111-1111-4111-8111-111111111111",
    selection: { billingMode: "platform" },
  })));
  assert.equal(request.prompt, prompt);
  assert.deepEqual(request.attachments, [brief]);
  draft.attachments[0].name = "edited-brief.txt";
  assert.equal(messages[0].attachments?.[0].name, "pasted-brief.txt");
});

test("retry targets the selected failure instead of a later follow-up", function () {
  const messages: ChatMessage[] = [
    { ...message("first-u", "user", "Read the original brief"), attachments: [{ name: "original.txt", content: "Original scope" }] },
    message("first-a", "assistant"),
    { ...message("second-u", "user", "Use the revised brief"), attachments: [{ name: "revised.txt", content: "Revised scope" }] },
    message("second-a", "assistant"),
  ];
  assert.deepEqual(retryDraft(messages, "first-a"), { prompt: "Read the original brief", attachments: messages[0].attachments });
  assert.deepEqual(retryDraft(messages, "second-a"), { prompt: "Use the revised brief", attachments: messages[2].attachments });
});

test("text-only retries do not inherit an earlier build's attachments", function () {
  const messages: ChatMessage[] = [
    { ...message("first-u", "user", "Original build"), attachments: [{ name: "brief.txt", content: "Original scope" }] },
    message("first-a", "assistant"),
    message("second-u", "user", "Change the background to blue"),
    message("second-a", "assistant"),
  ];
  assert.deepEqual(retryDraft(messages, "second-a"), { prompt: "Change the background to blue", attachments: [] });
});

test("missing reply or missing user draft cannot restore another message", function () {
  const messages = [message("reply", "assistant"), message("user", "user", "Build my app")];
  assert.equal(retryDraft(messages, "missing"), null);
  assert.equal(retryDraft(messages, "reply"), null);
  assert.equal(retryDraft(messages, "user"), null);
});
