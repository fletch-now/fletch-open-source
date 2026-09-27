// Extend the existing actual-component harness; every fetch stays on loopback.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let harness = await readFile("scripts/test-build-console.mjs", "utf8");
function replaceOnce(before, after) {
  assert.equal(harness.split(before).length, 2, "Console fixture anchor must stay unique");
  harness = harness.replace(before, after);
}

replaceOnce("if(new URL(location.href).searchParams.has('stopping'))", `if(new URL(location.href).searchParams.has('workerpaused'))window.emitBuild('status',{step:'Your source files are saved. This build is paused while we check an interruption.',buildState:'paused'});
          if(new URL(location.href).searchParams.has('stopping'))`);
replaceOnce("if(path==='/api/build-quotes')return Response.json({legacy:true});", "if(path.endsWith('/continue'))return Response.json({queued:true,message:'Saved progress is queued to continue.'},{status:202}); if(path==='/api/build-quotes')return Response.json({legacy:true});");
replaceOnce("if(path.includes('/files'))return Response.json({files:[]});", `if(path.includes('/files?')&&new URL(location.href).searchParams.has('workerpaused'))return Response.json({content:'contract Saved { uint256 public retained = 7; }'});
        if(path.includes('/files'))return Response.json({files:[]});`);
replaceOnce("initialNoContract={true}", "initialNoContract={true} initialArtifacts={new URL(location.href).searchParams.has('workerpaused')?[{path:'contracts/Saved.sol',kind:'contract',lines:2,preview:'contract Saved'}]:undefined}");
replaceOnce("  assert.deepEqual(errors, []);", String.raw`
  const building = await pageFor(390, 844, "/?stream=1&resume=1");
  await building.getByRole("group", { name: "Workspace mode" }).getByRole("button", { name: "Chat", exact: true }).click();
  await building.locator('[data-build-step-activity]').waitFor();
  assert.match(await building.locator('[data-build-step-activity]').innerText(), /prompt is being built|Reconnecting to progress/);
  await building.close();
  const manual = await pageFor(390, 844, "/?stream=1&workerpaused=1");
  await manual.getByRole("group", { name: "Workspace mode" }).getByRole("button", { name: "Chat", exact: true }).click();
  await manual.getByRole("button", { name: "Continue build", exact: true }).click();
  await manual.waitForFunction(() => window.fixtureRequests.some(path => path.endsWith('/continue')));
  await manual.waitForFunction(() => !document.querySelector('[data-build-recovery]'));
  await manual.close();
  const pausedNotice = "Your source files are saved. This build is paused while we check an interruption.";
  const queueToPaused = await queuedPage();
  await queueToPaused.evaluate(text => window.emitBuild("status", { step: text, buildState: "paused" }), pausedNotice);
  await queueToPaused.getByRole("status").filter({ hasText: "Fletch · paused" }).waitFor();
  assert.equal(await queueToPaused.getByRole("button", { name: "Cancel queue", exact: true }).count(), 0);
  assert.equal(await queueToPaused.getByRole("button", { name: "Edit prompt", exact: true }).count(), 0);
  assert.equal(await queueToPaused.locator('[data-build-reply="current-build"] [data-build-loader]').count(), 0);
  assert.equal(await queueToPaused.getByRole("button", { name: "Stop", exact: true }).isEnabled(), true);
  await queueToPaused.close();

  for (const width of [320, 1280]) {
    const paused = await pageFor(width, 844, "/?stream=1&workerpaused=1");
    await paused.getByRole("group", { name: "Workspace mode" }).getByRole("button", { name: "Chat", exact: true }).click();
    const reply = paused.locator('[data-build-reply="current-build"]');
    await reply.getByRole("status").filter({ hasText: "Fletch · paused" }).waitFor();
    await reply.getByText(pausedNotice, { exact: true }).waitFor();
    assert.equal(await reply.locator("[data-build-loader]").count(), 0, "Paused work must not appear to be generating");
    assert.equal(await reply.locator("[data-build-step-activity]").count(), 0);
    assert.equal(await paused.getByRole("button", { name: "Stop", exact: true }).isEnabled(), true);
    assert.equal(await paused.getByRole("link", { name: "Published app ↗", exact: true }).getAttribute("href"), origin + "/preview");
    await assertNoOverflow(paused);
    await paused.reload();
    await paused.getByRole("group", { name: "Workspace mode" }).getByRole("button", { name: "Chat", exact: true }).click();
    await reply.getByRole("status").filter({ hasText: "Fletch · paused" }).waitFor();
    await reply.getByText(pausedNotice, { exact: true }).waitFor();
    assert.equal(await reply.locator("[data-build-loader]").count(), 0, "Reload preserves the paused state without a loader");

    await paused.getByRole("button", { name: "Stop", exact: true }).click();
    await paused.waitForFunction(() => window.stopRequests.length === 1);
    assert.equal(await paused.getByRole("button", { name: "Stopping build", exact: true }).isDisabled(), true);
    assert.equal(await reply.getByRole("status").filter({ hasText: "Fletch · paused" }).count(), 0);
    assert.equal(await reply.locator("[data-build-loader]").count(), 1, "Requested cleanup remains visibly active");
    await paused.evaluate(() => {
      window.stopRequests[0].resolve(Response.json({ accepted: true, stopping: true, stopped: false }, { status: 202 }));
      window.emitBuild("status", { step: "Stop requested. Finishing cleanup and recording any transaction already sent.", buildState: "stopping" });
    });
    assert.equal(await paused.getByRole("button", { name: "Stopping build", exact: true }).isDisabled(), true);
    assert.equal(await paused.evaluate(() => window.fixtureAborts), 0, "Stop waits for worker settlement rather than aborting its subscription");
    await paused.evaluate(() => window.emitBuild("error", { message: "Stopped by you. Source files were retained.", canRetry: true }));
    await paused.getByText("Stopped by you. Source files were retained.", { exact: true }).waitFor();
    await paused.waitForFunction(() => !document.querySelector('[data-build-reply="current-build"] [data-build-loader]'));
    assert.equal(await paused.getByRole("button", { name: "Stopping build", exact: true }).count(), 0);
    assert.equal(await paused.getByRole("link", { name: "Published app ↗", exact: true }).getAttribute("href"), origin + "/preview");

    await paused.getByRole("group", { name: "Workspace mode" }).getByRole("button", { name: "Code", exact: true }).click();
    await paused.getByRole("tab", { name: "Saved.sol", exact: true }).click();
    await paused.waitForFunction(() => document.querySelector('[role="tabpanel"]')?.textContent.includes("retained = 7"));
    await paused.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { async writeText(text) { window.fixtureCopied = text; } } }));
    await paused.getByRole("button", { name: "Copy", exact: true }).click();
    assert.equal(await paused.evaluate(() => window.fixtureCopied), "contract Saved { uint256 public retained = 7; }", "Retained full source remains copyable after Stop");
    await assertNoOverflow(paused);
    assert.equal(await paused.evaluate(() => window.fixtureRequests.filter(path => path === "/api/builds").length), 0, "Reload and Stop never submit a replacement build");
    await paused.close();
  }
  console.log("PASS worker console: queued position/Cancel/Edit/reload from base harness; queue→paused; paused reload, Stop→Stopping→terminal, correct loaders, retained publication and full-source Copy at 320/1280px.");
  assert.deepEqual(errors, []);`);

const directory = await mkdtemp(join(tmpdir(), "fletch-worker-console-harness-"));
try {
  const file = join(directory, "console.mjs");
  await writeFile(file, harness);
  const child = spawn(process.execPath, [file], { stdio: "inherit", env: process.env });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(code, 0, "Worker console acceptance failed");
} finally {
  await rm(directory, { recursive: true, force: true });
}
