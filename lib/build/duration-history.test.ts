import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { readBuildDurationHistory } from "./duration-history";

test("timing history separates models and contract work, excludes waiting, failed and resumed runs", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function history() {
  const connectionString = process.env.FLETCH_TEST_DATABASE_URL;
  const admin = new Pool({ connectionString });
  const namespace = `duration_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const database = new Pool({ connectionString, options: `-c search_path=${namespace},public` });
  try {
    await database.query("create table builds (like public.builds including all)");
    await database.query("create table build_worker_jobs (like public.build_worker_jobs including all)");
    for (let index = 0; index < 5; index++) {
      await database.query(`insert into builds(id,user_id,prompt,provider,model,status,needs_contract,created_at,started_at,finished_at)
        values($1,'timing-test','Fixture','kimi','timing-model','succeeded',true,
          now() - interval '5 hours', now() - interval '1 hour' - ($2 * interval '1 minute'), now() - interval '1 hour')`, [`valid-${index}`, 8 + index]);
    }
    const estimate = await readBuildDurationHistory("kimi", "timing-model", true, database);
    assert.equal(estimate?.sampleSize, 5);
    assert.equal(estimate?.lowerMinutes, 8);
    assert.equal(estimate?.upperMinutes, 12);
    assert.equal(await readBuildDurationHistory("openai", "timing-model", true, database), null);
    assert.equal(await readBuildDurationHistory("kimi", "another-model", true, database), null);
    assert.equal(await readBuildDurationHistory("kimi", "timing-model", false, database), null);
    for (const id of ["failed", "stale", "future", "reversed", "resumed"]) {
      await database.query(`insert into builds(id,user_id,prompt,provider,model,status,needs_contract,started_at,finished_at)
        values($1,'timing-test','Fixture','kimi','timing-model','succeeded',true,
          now() - interval '10 hours', now() - interval '1 hour')`, [id]);
    }
    await database.query("update builds set status='failed' where id='failed'");
    await database.query("update builds set started_at=now()-interval '32 days',finished_at=now()-interval '31 days' where id='stale'");
    await database.query("update builds set finished_at=now()+interval '1 day' where id='future'");
    await database.query("update builds set started_at=now() where id='reversed'");
    await database.query("insert into build_worker_jobs(build_id,workspace_key,state,attempt) values('resumed','timing-resumed','completed',2)");
    assert.equal((await readBuildDurationHistory("kimi", "timing-model", true, database))?.sampleSize, 5);
  } finally {
    await database.end();
    await admin.query(`drop schema ${namespace} cascade`);
    await admin.end();
  }
});
