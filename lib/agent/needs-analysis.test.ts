import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyseNeeds, NeedsAnalysisError } from "./needs-analysis";
import { needsAnalysisContext, type NeedsBrief } from "./needs-context";
import { NEEDS_SYSTEM_PROMPT } from "./needs-rules";
import type { streamChat } from "./chat";
import type { ProviderConfig } from "./provider";
import { briefInstruction, pastedBrief } from "@/lib/build/pasted-brief";
import { MAX_TEXT_BYTES } from "@/lib/build/attachments";
import type { BuildImageAttachment } from "@/lib/build/types";

const provider: ProviderConfig = {
  id: "kimi", baseUrl: "https://provider.invalid/v1", apiKey: "controlled-test-key", model: "kimi-k3",
  inputPerMTok: 0, outputPerMTok: 0, bringYourOwnKey: true,
};

test("planning accepts a response after the old 25-second deadline", async function (t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  let signal: AbortSignal | undefined;
  let finish: (() => void) | undefined;
  const pending = analyseNeeds(provider, { prompt: "A full app with an attached brief" }, false,
    async function delayed(_provider, _messages, options) {
      requests += 1;
      signal = options?.signal;
      await new Promise<void>(function wait(resolve) { finish = resolve; });
      signal?.throwIfAborted();
      return { text: '{"contract":true,"wallet":true,"reason":"Users deposit tokens into the contract."}', usage: null, finishReason: "stop" };
    });
  assert.ok(finish);
  t.mock.timers.tick(26_000);
  assert.equal(signal?.aborted, false);
  finish();
  assert.equal((await pending).verdict.source, "model");
  assert.equal(requests, 1);
});

test("a planner timeout ends the request without a second request or fallback", async function (t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  const pending = analyseNeeds(provider, { prompt: "A new app" }, false,
    async function neverAnswers(_provider, _messages, options) {
      requests += 1;
      await new Promise<void>(function wait(_resolve, reject) {
        options!.signal!.addEventListener("abort", function aborted() { reject(options!.signal!.reason); }, { once: true });
      });
      throw new Error("Unexpected response");
    });
  const rejected = assert.rejects(pending, function planningError(error: unknown): boolean {
    assert.ok(error instanceof NeedsAnalysisError);
    assert.match(error.message, /Planning took longer than three minutes/);
    return true;
  });
  t.mock.timers.tick(180_000);
  await rejected;
  assert.equal(requests, 1);
});

test("a disconnected planner fails once; only returned unparseable answers are retried", async function () {
  let disconnected = 0;
  await assert.rejects(analyseNeeds(provider, { prompt: "A new app" }, false, async function failure() {
    disconnected += 1;
    throw new Error("controlled connection loss");
  }), NeedsAnalysisError);
  assert.equal(disconnected, 1);

  let returned = 0;
  const result = await analyseNeeds(provider, { prompt: "A new app" }, false, async function unusable() {
    returned += 1;
    return { text: "Unparseable response", usage: { inputTokens: 10, outputTokens: 5 }, finishReason: "stop" };
  });
  assert.equal(returned, 2);
  assert.equal(result.verdict.source, "fallback");
  assert.equal(result.verdict.contract, true);
  assert.equal(result.verdict.wallet, true);
  assert.equal(result.cost?.inputTokens, 20);
});

test("the planner receives the complete auto-attached launchpad brief before deciding contract and wallet needs", async function () {
  const specification = [
    "Build a token launchpad for Robinhood Chain.",
    "A factory deploys a new ERC-20 token and bonding curve contract for each launch.",
    "Users connect one wallet and sign transactions to create, buy and sell tokens.",
    "The final requirement is a withdrawable creator-fee balance: END-OF-COMPLETE-BRIEF.",
  ].join("\n");
  const attachment = pastedBrief(specification, []);
  const prompt = briefInstruction(attachment.name);
  let requests = 0;
  const capture: typeof streamChat = async function captureRequest(config, messages) {
    requests++;
    assert.equal(config, provider, "the bound provider handles the planner request");
    assert.equal(messages[0].content, NEEDS_SYSTEM_PROMPT, "architecture rules are unchanged");
    assert.equal(messages[1].role, "user");
    assert.ok(messages[1].content.startsWith(prompt));
    assert.ok(messages[1].content.includes(specification), "the request contains every byte of the attached brief");
    assert.ok(messages[1].content.includes(attachment.name));
    assert.ok(messages[1].content.includes("END-OF-COMPLETE-BRIEF"));
    return { text: '{"contract":true,"wallet":true,"reason":"A factory creates tokens with a bonding curve and signed buy/sell transactions."}', usage: { inputTokens: 100, outputTokens: 30 }, finishReason: "stop" };
  };
  const analysis = await analyseNeeds(provider, { prompt, attachments: [attachment] }, false, capture);
  assert.equal(requests, 1);
  assert.equal(analysis.verdict.contract, true);
  assert.equal(analysis.verdict.wallet, true);
  assert.equal(analysis.verdict.source, "model");
});

test("all text files and their tails reach the planner without changing a text-only prompt", async function () {
  const prompt = "Read the supplied files in full.";
  const attachments = [
    { name: "first.md", content: "a".repeat(MAX_TEXT_BYTES - 10) + "FIRST-TAIL" },
    { name: "second.txt", content: "b".repeat(MAX_TEXT_BYTES - 11) + "SECOND-TAIL" },
  ];
  assert.equal(needsAnalysisContext({ prompt }), prompt);
  let captured = "";
  await analyseNeeds(provider, { prompt, attachments }, false, async function capture(_, messages) {
    captured = messages[1].content;
    return { text: '{"contract":false,"wallet":false,"reason":"Only public data is read."}', usage: null, finishReason: "stop" };
  });
  for (const attachment of attachments) assert.ok(captured.includes(attachment.content));
  assert.ok(captured.includes('"first.md"') && captured.includes('"second.txt"'));
  assert.ok(captured.indexOf("FIRST-TAIL") < captured.indexOf("SECOND-TAIL"));
});

test("oversized text fails before any planner request or fallback can omit part of the brief", async function () {
  let requests = 0;
  const request: typeof streamChat = async function forbidden() { requests++; throw new Error("must not reach a provider"); };
  const brief = { prompt: "Use every attached requirement.", attachments: [
    { name: "first.txt", content: "a".repeat(MAX_TEXT_BYTES) },
    { name: "second.txt", content: "b".repeat(MAX_TEXT_BYTES) },
    { name: "last.txt", content: "contract and wallet requirements at the end" },
  ] };
  await assert.rejects(analyseNeeds(provider, brief, false, request), /128 KB.*No needs analysis was run/);
  assert.equal(requests, 0);
  assert.throws(() => needsAnalysisContext({ prompt: "Use this brief.", attachments: [{ name: "wide.txt", content: "界".repeat(Math.ceil(MAX_TEXT_BYTES / 3) + 1) }] }), /64 KB/, "the attachment bound counts UTF-8 bytes, not characters");
  const malformed = { prompt: "Use this brief.", attachments: [{ kind: "unsupported", name: "brief.txt", content: "Create a contract." }] } as unknown as NeedsBrief;
  await assert.rejects(analyseNeeds(provider, malformed, false, request), /complete brief could not be read.*No needs analysis was run/);
  await assert.rejects(analyseNeeds(provider, { prompt: "Use this brief.", attachments: null } as unknown as NeedsBrief, false, request), /complete brief could not be read/);
  assert.equal(requests, 0, "an unsupported attachment cannot be dropped before classifying");
});

test("an existing contract keeps the existing verdict without making a provider request", async function () {
  const analysis = await analyseNeeds(provider, { prompt: "Read the supplied change.", attachments: [{ name: "edit.md", content: "Change the visible heading only." }] }, true,
    async function forbidden() { throw new Error("existing contract should not call a provider"); });
  assert.equal(analysis.verdict.source, "existing");
  assert.equal(analysis.verdict.contract, true);
  assert.equal(analysis.cost, null);
});

test("assembling text briefs preserves the provider's existing native image binding", async function () {
  const image: BuildImageAttachment = { kind: "image", name: "reference.png", mediaType: "image/png", data: "iVBORw0KGgo=" };
  const referenceImages = [image];
  const imageProvider = { ...provider, referenceImages };
  await analyseNeeds(imageProvider, { prompt: "Use the attached reference.", attachments: [image, { name: "brief.txt", content: "Build a token factory with signed wallet actions." }] }, false,
    async function capture(config, messages) {
      assert.equal(config.referenceImages, referenceImages);
      assert.equal(config.referenceImages?.[0], image);
      assert.ok(messages[1].content.includes("token factory"));
      assert.equal(messages[1].content.includes(image.data), false, "native images remain in the existing provider binding");
      return { text: '{"contract":true,"wallet":true,"reason":"Factory deployment requires a signature."}', usage: null, finishReason: "stop" };
    });
});
