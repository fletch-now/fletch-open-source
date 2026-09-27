import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitPreview,
  previewViewport,
  DEVICE_VIEWPORTS,
} from "../../components/chat/preview-viewport";
import {
  modeKey,
  readMode,
  saveMode,
} from "../../components/chat/workspace-mode";
import { progressSteps } from "../../components/chat/progress-steps";
import type { ProgressTrackProps } from "../../components/chat/progress-steps";

const idle: ProgressTrackProps = {
  stage: "done",
  running: false,
  result: null,
  noContract: false,
  hasThread: true,
};

test("preview fit respects both axes without changing the device viewport", function () {
  assert.deepEqual(previewViewport(729.5, 512.2, "responsive"), { width: 729, height: 512 });
  assert.equal(fitPreview(729, 512, "responsive"), 1);
  assert.deepEqual(previewViewport(729, 512, "desktop"), { width: 1440, height: 900 });
  assert.equal(fitPreview(720, 900, "desktop"), 0.5);
  assert.equal(fitPreview(1440, 450, "desktop"), 0.5);
  assert.equal(fitPreview(2000, 2000, "desktop"), 1);
  assert.equal(fitPreview(0, 0, "phone"), 0);
  assert.equal(fitPreview(300, 600, "phone"), Math.min(300 / 390, 600 / 844));
  assert.deepEqual(DEVICE_VIEWPORTS.tablet, { width: 768, height: 1024 });
});

test("workspace modes stay separate per project and ignore invalid or blocked storage", function () {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
  };
  saveMode(storage, "code", "first");
  saveMode(storage, "chat", "second");
  assert.equal(readMode(storage, "first"), "code");
  assert.equal(readMode(storage, "second"), "chat");
  saveMode(storage, "preview");
  saveMode(storage, readMode(storage)!, "created");
  assert.equal(readMode(storage, "created"), "preview");
  values.set(modeKey("first"), "developer");
  assert.equal(readMode(storage, "first"), null);
  const blocked = {
    getItem(): never {
      throw new Error("blocked");
    },
    setItem(): never {
      throw new Error("blocked");
    },
  };
  assert.equal(readMode(blocked, "first"), null);
  assert.doesNotThrow(function write() {
    saveMode(blocked, "chat", "first");
  });
});

test("a finished build or model notes cannot claim compiler or hosting success", function () {
  for (const result of [
    null,
    {},
    { notes: ["Built and tested everything"] },
    { notes: ["Front end did not build"] },
  ]) {
    const steps = progressSteps({ ...idle, result });
    assert.equal(steps[1].state, "todo");
    assert.equal(steps[2].state, "todo");
    assert.equal(steps[3].state, "todo");
    assert.equal(steps[2].href, undefined);
  }
});

test("saved publication and deploy receipts remain linked after a failed follow-up", function () {
  const result = {
    previewUrl: "https://example.test",
    contractAddress: "0x1234",
    explorerUrl: "https://explorer.test/address/0x1234",
    notes: ["Latest build failed"],
  };
  const steps = progressSteps({ ...idle, result });
  assert.equal(steps[1].href, result.explorerUrl);
  assert.equal(steps[1].detail, "Deployment recorded");
  assert.equal(steps[2].href, result.previewUrl);
  assert.equal(steps[3].state, "done");
});

test("frontend-only checks are skipped; a failed compile is blocked", function () {
  assert.equal(
    progressSteps({ ...idle, noContract: true })[1].state,
    "skipped",
  );
  const compile = {
    ok: false,
    solc: "0.8.26",
    contracts: [],
    errors: [],
    warnings: 0,
    durationMs: 1,
  };
  assert.equal(progressSteps({ ...idle, compile })[1].state, "blocked");
  const compiled = progressSteps({
    ...idle,
    compile: { ...compile, ok: true },
  })[1];
  assert.equal(compiled.detail, "Compiled · tests not recorded");
  assert.equal(compiled.href, undefined);
});

test("long build replies fold the full account behind a bounded verbatim opening", async function () {
  const { briefReply } = await import("./brief-reply");
  const short = "Changed the button label.";
  assert.deepEqual(briefReply(short), { brief: short, folded: false });
  const long =
    "Changed the button label. Kept the current colors. Updated the form. Added another change.\n\nTechnical details follow.";
  assert.equal(
    briefReply(long).brief,
    "Changed the button label. Kept the current colors. Updated the form.",
  );
  assert.equal(briefReply(long).folded, true);
  assert.ok(briefReply("Long response ".repeat(100)).brief.length <= 481);
  assert.equal(briefReply("```ts\nconst value = 1;\n```").folded, true);
});

test("persisted artifact badges require matching current hashes and handle legacy gaps", async function () {
  const { artifactChanges } = await import("./artifact-changes");
  const original = {
    path: "app.ts",
    kind: "app" as const,
    lines: 1,
    contentHash: "before",
  };
  const latest = { ...original, contentHash: "after" };
  assert.deepEqual(artifactChanges([original], [latest], [latest]), {
    "app.ts": "changed",
  });
  assert.deepEqual(artifactChanges([original], [original], [original]), {});
  assert.deepEqual(
    artifactChanges(
      [original],
      [latest],
      [{ ...latest, contentHash: "external-edit" }],
    ),
    {},
  );
  assert.deepEqual(artifactChanges([], [latest], [latest]), {
    "app.ts": "updated",
  });
  assert.deepEqual(artifactChanges([], [latest], [latest], true), {
    "app.ts": "new",
  });
  assert.deepEqual(
    artifactChanges(
      [original],
      [{ ...latest, contentHash: undefined }],
      [latest],
    ),
    { "app.ts": "updated" },
  );
  assert.deepEqual(
    artifactChanges([original], [latest, original], [original]),
    {},
  );
  assert.deepEqual(artifactChanges([original], [], [latest]), {});
});

test("a failed follow-up keeps published receipts; a new contract cannot inherit prior verification", async function () {
  const { mergePublishedResult } = await import("./published-result");
  const saved = {
    previewUrl: "https://example.test",
    contractAddress: "0x111",
    explorerUrl: "https://explorer.test/0x111",
    verified: true,
  };
  const failed = mergePublishedResult(saved, { notes: ["Follow-up failed"] });
  assert.equal(failed.previewUrl, saved.previewUrl);
  assert.equal(failed.explorerUrl, saved.explorerUrl);
  assert.equal(failed.verified, true);
  const deployed = mergePublishedResult(saved, { contractAddress: "0x222" });
  assert.equal(deployed.previewUrl, saved.previewUrl);
  assert.equal(deployed.explorerUrl, undefined);
  assert.equal(deployed.verified, undefined);
});
