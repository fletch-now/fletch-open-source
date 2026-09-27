import "server-only";
import type { Pool } from "pg";
import { MAX_PROJECT_CONVERSATION_CHARS, MAX_SAVED_SUMMARY_CHARS } from "@/lib/agent/context-policy";

interface ConversationRow {
  id: string;
  prompt: string;
  status: string;
  error: string | null;
  total: number;
  notices: string[];
}

function excerpt(text: string, maximum: number): string {
  return text.length <= maximum ? text : `${text.slice(0, maximum)}\n[Excerpt; the full record remains in project history.]`;
}

function turnContext(row: ConversationRow): string {
  const notes: string[] = [];
  let tasks = "";
  for (const chunk of row.notices) {
    try {
      const event = JSON.parse(chunk);
      if (event.phase === "scaffolding" && typeof event.toolOutput === "string") {
        tasks = excerpt(event.toolOutput, 3000);
      } else if (typeof event.text === "string") {
        notes.push(excerpt(event.text, 1000));
      }
    } catch { /* Older malformed log entries cannot establish progress. */ }
  }
  return [
    `Previous build ${row.id} (${row.status})`,
    `User request:\n${excerpt(row.prompt, 3500)}`,
    notes.length ? `Recorded assistant notes and outcomes:\n${notes.join("\n\n")}` : "",
    tasks ? `Last recorded task list for this build:\n${tasks}` : "",
    row.error ? `Recorded failure:\n${excerpt(row.error, 700)}` : "",
  ].filter(Boolean).join("\n\n");
}

function conversationContext(turns: string[], total: number, summary: string): string {
  return `Saved project conversation and progress: ${turns.length} of ${total} prior builds, chronological excerpts. Full records remain in project history. The original objective and latest request are also supplied separately.
Assistant notes and task lists are historical observations, not verified completion or current platform constraints. Current instructions take precedence; check saved files and tool results before relying on a claim. Start with the next unfinished task. Inspect the files needed for that task instead of repeating broad discovery unless the recorded context conflicts with the workspace.

${summary}${turns.join("\n\n---\n\n")}`;
}

// A portable handoff is needed even when a provider cannot resume its native
// session. Read only this owner's history preceding the accepted request.
export async function projectConversation(database: Pick<Pool, "query">, buildId: string, userId: string, projectId: string | null): Promise<string | undefined> {
  if (!projectId) return undefined;
  const saved = await database.query<{ summary: string; build_id: string; log_seq: number }>(`
    select event.detail->>'summary' as summary,old.id as build_id,(event.detail->>'logSeq')::integer as log_seq
    from builds current join projects project on project.id=current.project_id and project.user_id=current.user_id
    join builds old on old.project_id=current.project_id and old.user_id=current.user_id
    join build_worker_events event on event.build_id=old.id and event.kind='context_summary'
    where current.id=$1 and current.user_id=$2 and current.project_id=$3
      and (old.created_at,old.id)<(current.created_at,current.id) and event.created_at<=current.created_at
      and length(event.detail->>'summary') between 1 and $4
    order by old.created_at desc,old.id desc,event.seq desc limit 1
  `, [buildId, userId, projectId, MAX_SAVED_SUMMARY_CHARS]);
  const memory = saved.rows[0];
  const result = await database.query<ConversationRow>(`
    with previous as (
      select old.id,left(old.prompt,12000) as prompt,old.status,left(old.error,700) as error,
        old.created_at,current.created_at as before_at,count(*) over()::integer as total
      from builds current join projects project on project.id=current.project_id and project.user_id=current.user_id
      join builds old on old.project_id=current.project_id and old.user_id=current.user_id
      where current.id=$1 and current.user_id=$2 and current.project_id=$3
        and (old.created_at,old.id)<(current.created_at,current.id) and old.started_at is not null
        and ($4::text is null or (old.created_at,old.id)>=(select created_at,id from builds where id=$4))
      order by old.created_at desc,old.id desc limit 12
    )
    select previous.*,coalesce(logs.notices,'[]'::json) as notices from previous
    left join lateral (
      select json_agg(chunk order by seq) as notices from (
        (select seq,left(chunk,18000) as chunk from build_logs
          where build_id=previous.id and created_at<=previous.before_at and level in ('note','done','error')
            and (previous.id<>$4 or seq>$5 or $4::text is null)
          order by seq desc limit 4)
        union
        (select seq,left(chunk,18000) as chunk from build_logs
          where build_id=previous.id and created_at<=previous.before_at and level='scaffolding'
            and chunk like '%Current todo list:%' order by seq desc limit 1)
      ) retained
    ) logs on true order by previous.created_at desc,previous.id desc
  `, [buildId, userId, projectId, memory?.build_id ?? null, memory?.log_seq ?? -1]);
  if (!result.rows.length) return undefined;
  const turns: string[] = [];
  const total = result.rows[0].total;
  const summary = memory ? `Saved conversation summary from build ${memory.build_id}. This condenses earlier model context; later requests and recorded results below take precedence.\n${memory.summary}\n\n` : "";
  let context = conversationContext(turns, total, summary);
  for (const row of result.rows) {
    const text = turnContext(row);
    const candidate = conversationContext([text, ...turns], total, summary);
    if (candidate.length > MAX_PROJECT_CONVERSATION_CHARS) break;
    turns.unshift(text);
    context = candidate;
  }
  return context;
}
