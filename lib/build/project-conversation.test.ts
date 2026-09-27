import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { Pool } from "pg";
import { projectConversation } from "./project-conversation";
import { needsAnalysisContext, projectRequestContext } from "@/lib/agent/needs-context";
import { MAX_PROJECT_CONVERSATION_CHARS, MAX_SAVED_SUMMARY_CHARS } from "@/lib/agent/context-policy";
import { analyseNeeds } from "@/lib/agent/needs-analysis";

function conversationDatabase(t: TestContext, count: number, summary?: string): Pool {
  const database = new Pool();
  const rows = Array.from({ length: count }, function row(_, index) {
    return {
      id: `previous-${count - index}`,
      prompt: `Request ${count - index}: ${"requirement ".repeat(400)}`,
      status: "failed",
      error: "Recorded failure. ".repeat(50),
      total: count,
      notices: [
        ...Array.from({ length: 4 }, function note() {
          return JSON.stringify({ phase: "note", text: "Recorded progress. ".repeat(100) });
        }),
        JSON.stringify({ phase: "scaffolding", toolOutput: "Current todo list:\n[done] Contract\n[in_progress] Stylesheet\n[pending] Verify keyboard controls" }),
      ],
    };
  });
  t.mock.method(database, "query", async function query(sql: string) {
    if (sql.includes("select event.detail")) {
      return { rows: summary === undefined ? [] : [{ summary, build_id: "summary-build", log_seq: 7 }] };
    }
    return { rows };
  });
  t.after(async function cleanup() { await database.end(); });
  return database;
}

test("long portable history and a maximum summary both pass follow-up validation with the complete brief", async function retained(t): Promise<void> {
  const tail = "\nLAST-PENDING-COMPACTION-STEP";
  const summary = "ORIGINAL-COMPACTION-DECISION\n".padEnd(MAX_SAVED_SUMMARY_CHARS - tail.length, "s") + tail;
  assert.equal(summary.length, MAX_SAVED_SUMMARY_CHARS);
  for (const saved of [undefined, summary]) {
    const database = conversationDatabase(t, 12, saved);
    const conversation = await projectConversation(database, "current", "owner", "project");
    assert.ok(conversation && conversation.length > 40_000);
    assert.ok(conversation.length <= MAX_PROJECT_CONVERSATION_CHARS);
    assert.match(conversation, /Previous build previous-12/);
    assert.match(conversation, /\[in_progress\] Stylesheet/);
    assert.match(conversation, /\[pending\] Verify keyboard controls/);
    if (saved) assert.ok(conversation.includes(saved), "Every character of a valid saved summary survives");
    const first = `Original objective: read brief/original.md. ${"original requirement ".repeat(400)}ORIGINAL-REQUEST-TAIL`;
    const latest = `Latest correction: preserve the recipient table. ${"latest requirement ".repeat(400)}LATEST-REQUEST-TAIL`;
    const attachment = { name: "original.md", content: `ORIGINAL-BRIEF-START\n${"requirement ".repeat(5000)}\nORIGINAL-BRIEF-TAIL` };
    const current = "Continue the unfinished stylesheet and then verify keyboard controls.";
    const brief = { prompt: current, projectRequests: [first, latest], projectConversation: conversation, attachments: [attachment], restoredBriefs: [attachment.name] };
    const context = needsAnalysisContext(brief);
    for (const text of [first, latest, current, attachment.content, conversation]) assert.ok(context.includes(text));
    assert.ok(context.indexOf(first) < context.indexOf(latest));
    assert.ok(context.indexOf(latest) < context.indexOf(current));
    assert.ok(projectRequestContext(brief).endsWith(current), "The current request retains the final instruction position");
    let requests = 0;
    const result = await analyseNeeds({ id: "kimi", model: "fixture", baseUrl: "https://unused.invalid", apiKey: "fixture", bringYourOwnKey: true, inputPerMTok: 0, outputPerMTok: 0 }, brief, false,
      async function capture(_provider, messages) {
        requests++;
        assert.equal(messages[1].content, context);
        return { text: '{"contract":false,"wallet":false,"reason":"The next task is the stylesheet."}', usage: null, finishReason: "stop" };
      });
    assert.equal(requests, 1, "Long recovered context reaches the planner after validation");
    assert.equal(result.verdict.source, "model");
  }
});

test("the history budget includes every header and separator and drops an older whole turn at the boundary", async function boundary(t): Promise<void> {
  const initial = await projectConversation(conversationDatabase(t, 3, "s"), "current", "owner", "project");
  assert.ok(initial);
  const summary = "s".repeat(MAX_PROJECT_CONVERSATION_CHARS - initial.length + 1);
  assert.ok(summary.length < MAX_SAVED_SUMMARY_CHARS);
  const exact = await projectConversation(conversationDatabase(t, 3, summary), "current", "owner", "project");
  assert.equal(exact!.length, MAX_PROJECT_CONVERSATION_CHARS);
  assert.match(exact!, /3 of 3 prior builds/);
  assert.doesNotThrow(function validate() { needsAnalysisContext({ prompt: "Continue", projectConversation: exact }); });

  const bounded = await projectConversation(conversationDatabase(t, 3, summary + "s"), "current", "owner", "project");
  assert.ok(bounded && bounded.length < MAX_PROJECT_CONVERSATION_CHARS);
  assert.ok(bounded.includes(summary + "s"));
  assert.match(bounded, /2 of 3 prior builds/);
  assert.doesNotMatch(bounded, /Previous build previous-1 /);
  assert.ok(bounded.indexOf("Previous build previous-2") < bounded.indexOf("Previous build previous-3"));
  assert.match(bounded, /\[pending\] Verify keyboard controls/);
  assert.throws(function overBudget() { needsAnalysisContext({ prompt: "Continue", projectConversation: exact + "x" }); }, /saved project conversation exceeds its context budget/);
});

test("portable conversation retains intervening changes, assistant progress and tasks with owner and time boundaries", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function conversation(t) {
  const database = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL, max: 1 });
  const namespace = `conversation_${randomUUID().replaceAll("-", "")}`;
  await database.query(`create schema ${namespace}; set search_path to ${namespace}`);
  t.after(async function cleanup() { await database.query(`drop schema ${namespace} cascade`); await database.end(); });
  await database.query(`create table projects(id text primary key,user_id text);
    create table builds(id text primary key,project_id text,user_id text,prompt text,status text,error text,created_at timestamptz,started_at timestamptz);
    create table build_logs(build_id text,seq integer,level text,chunk text,created_at timestamptz);
    create table build_worker_events(build_id text,seq integer,kind text,detail jsonb,created_at timestamptz);
    insert into projects values('project','owner'),('other','other-owner')`);
  async function build(id: string, day: number, prompt: string, owner = "owner", project = "project"): Promise<void> {
    await database.query("insert into builds values($1,$2,$3,$4,'failed',null,$5,$5)", [id, project, owner, prompt, new Date(`2020-01-${String(day).padStart(2, "0")}`)]);
  }
  async function log(id: string, seq: number, event: Record<string, unknown>, day = 4): Promise<void> {
    await database.query("insert into build_logs values($1,$2,$3,$4,$5)", [id, seq, event.phase, JSON.stringify(event), new Date(`2020-01-${String(day).padStart(2, "0")}`)]);
  }
  await build("original", 1, "Build a medieval strategy game.");
  await build("middle", 2, "Keep the forest theme and use a ten-by-ten board.");
  await build("last", 3, "Add multiplayer wallet actions.");
  await build("current", 5, "Continue the unfinished work.");
  await build("future", 6, "FUTURE-REQUEST-MUST-NOT-LEAK");
  await build("foreign", 2, "OTHER-OWNER-MUST-NOT-LEAK", "other-owner", "other");
  await log("last", 1, { phase: "note", text: "Contract tests passed previously. The stylesheet is unfinished." });
  await log("last", 2, { phase: "scaffolding", toolOutput: "Current todo list:\n[done] Contract\n[in_progress] Stylesheet\n[pending] Design review" });
  await log("last", 3, { phase: "scaffolding", toolOutput: "FULL-SOURCE-OUTPUT-MUST-NOT-BLOAT-CONTEXT" });
  await log("last", 4, { phase: "note", text: "LATER-LOG-MUST-NOT-LEAK" }, 6);
  const memory = await projectConversation(database, "current", "owner", "project");
  assert.ok(memory);
  assert.match(memory, /3 of 3 prior builds/);
  assert.match(memory, /forest theme/);
  assert.match(memory, /stylesheet is unfinished/);
  assert.match(memory, /\[in_progress\] Stylesheet/);
  assert.doesNotMatch(memory, /MUST-NOT/);
  assert.ok(memory.indexOf("medieval") < memory.indexOf("multiplayer"));
  const prompt = projectRequestContext({ prompt: "Now finish the stylesheet", projectConversation: memory });
  assert.ok(prompt.endsWith("Now finish the stylesheet"));
  for (const [owner, project] of [["other-owner", "project"], ["owner", "other"]]) {
    assert.equal(await projectConversation(database, "current", owner, project), undefined);
  }
  assert.equal(await projectConversation(database, "current", "owner", null), undefined);

  await database.query("update builds set prompt=repeat('large request ',5000) where id in ('original','middle','last')");
  for (let seq = 5; seq < 9; seq++) await log("last", seq, { phase: "note", text: "large note ".repeat(8000) });
  const bounded = await projectConversation(database, "current", "owner", "project");
  assert.ok(bounded && bounded.length <= MAX_PROJECT_CONVERSATION_CHARS);
  assert.match(bounded, /Excerpt/);
  assert.match(bounded, /\[in_progress\] Stylesheet/, "The latest task list survives long narration");

  await database.query("update builds set prompt='retained request' where id in ('original','middle','last')");
  await database.query("insert into build_worker_events values('middle',1,'context_summary',$1,'2020-01-04'),('foreign',2,'context_summary',$2,'2020-01-04'),('last',3,'context_summary',$2,'2020-01-06')",
    [JSON.stringify({ summary: "I keep the original forest theme. DECISION-BEFORE-COMPACTION. Finish the stylesheet, then verify the design.", logSeq: 0 }), JSON.stringify({ summary: "SUMMARY-MUST-NOT-LEAK", logSeq: 0 })]);
  await log("middle", 0, { phase: "note", text: "DUPLICATE-PRE-SUMMARY-NOTE" });
  const compacted = await projectConversation(database, "current", "owner", "project");
  assert.match(compacted!, /Saved conversation summary/);
  assert.match(compacted!, /DECISION-BEFORE-COMPACTION/);
  assert.match(compacted!, /\[in_progress\] Stylesheet/);
  assert.doesNotMatch(compacted!, /MUST-NOT-LEAK|DUPLICATE-PRE-SUMMARY-NOTE/);
  assert.ok(compacted!.length <= MAX_PROJECT_CONVERSATION_CHARS);

  const summary = "Retain the forest theme and finish the stylesheet. ".padEnd(MAX_SAVED_SUMMARY_CHARS, "界");
  await database.query("update build_worker_events set detail=jsonb_set(detail,'{summary}',$1::jsonb) where build_id='middle'", [JSON.stringify(summary)]);
  const long = await projectConversation(database, "current", "owner", "project");
  assert.ok(long && long.length > 40_000 && long.length <= MAX_PROJECT_CONVERSATION_CHARS);
  assert.ok(long.includes(summary), "The complete maximum-sized summary survives the database handoff");
  assert.match(long, /\[in_progress\] Stylesheet/);
  const validated = needsAnalysisContext({ prompt: "Finish the stylesheet", projectConversation: long });
  assert.ok(validated.includes(summary));
  assert.ok(validated.endsWith("Finish the stylesheet"));
});
