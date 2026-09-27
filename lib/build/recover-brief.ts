import "server-only";
import type { Pool } from "pg";
import { BuildAttachmentsSchema, isImageAttachment } from "@/lib/build/attachments";
import { BuildBriefError, referencedBriefNames } from "@/lib/agent/needs-context";
import type { BuildAttachment, BuildInput } from "@/lib/build/types";

// The submitted copies are authoritative. Never recover instructions by reading
// files that the coding agent could have changed in the shared workspace.
export async function recoverBuildBrief(
  database: Pick<Pool, "query">,
  input: BuildInput,
  userId: string,
  projectId: string | null,
): Promise<BuildInput> {
  if (!projectId) return input;
  const supplied = BuildAttachmentsSchema.safeParse(input.attachments ?? []);
  if (!supplied.success) throw new BuildBriefError("The submitted attachments could not be read. Attach them again before retrying.");
  const history = await database.query<{ prompt: string }>(`
    with history as (
      select old.id,old.prompt,old.created_at from builds current
      join projects project on project.id=current.project_id and project.user_id=current.user_id
      join builds old on old.project_id=current.project_id and old.user_id=current.user_id
      where current.id=$1 and current.user_id=$2 and current.project_id=$3
        and (old.created_at,old.id)<(current.created_at,current.id) and old.started_at is not null
      union all
      select a.id||saved.ordinality::text,saved.prompt,a.created_at
      from builds current join projects project on project.id=current.project_id and project.user_id=current.user_id
      join audit_log a on a.resource_id=project.id and a.user_id=current.user_id and a.action='project.source_restored'
      cross join lateral jsonb_array_elements_text(a.metadata->'projectRequests') with ordinality saved(prompt,ordinality)
      where current.id=$1 and current.user_id=$2 and current.project_id=$3 and a.created_at<=current.created_at
    )
    select prompt from (
      (select * from history order by created_at,id limit 1)
      union
      (select * from history order by created_at desc,id desc limit 1)
    ) retained order by created_at,id
  `, [input.buildId, userId, projectId]);
  const projectRequests = [...new Set(history.rows.map(function request(row) { return row.prompt; }))]
    .filter(function different(prompt) { return prompt !== input.prompt; });
  const contextual = { ...input, projectRequests };
  const names = referencedBriefNames(input.prompt);
  if (supplied.data.length === 0) {
    // Earlier references help a short continuation recover its objective. An
    // explicitly supplied new brief can replace those older requirements.
    names.push(...projectRequests.flatMap(referencedBriefNames).filter(function text(name) { return !/\.(png|jpe?g)$/i.test(name); }));
  }
  const present = new Set(supplied.data.map(function name(file) { return file.name.toLowerCase(); }));
  const missing = names.filter(function absent(name) { return !present.has(name.toLowerCase()); });
  if (missing.length === 0 && supplied.data.length > 0) return contextual;

  const result = await database.query<{ attachment: BuildAttachment }>(`
    with previous as (
      select old.id, old.created_at, old.attachments
      from builds current
      join projects project on project.id=current.project_id and project.user_id=current.user_id
      join builds old on old.project_id=current.project_id and old.user_id=current.user_id
      where current.id=$1 and current.user_id=$2 and current.project_id=$3
        and (old.created_at,old.id)<(current.created_at,current.id)
        and old.started_at is not null
      union all
      select a.id,a.created_at,a.metadata->'attachments'
      from builds current join projects project on project.id=current.project_id and project.user_id=current.user_id
      join audit_log a on a.resource_id=project.id and a.user_id=current.user_id and a.action='project.source_restored'
      where current.id=$1 and current.user_id=$2 and current.project_id=$3 and a.created_at<=current.created_at
    ), latest_brief as (
      select id from previous where jsonb_array_length(coalesce(attachments,'[]'::jsonb))>0
      order by created_at desc,id desc limit 1
    )
    select distinct on (lower(file->>'name')) file as attachment
    from previous cross join lateral jsonb_array_elements(coalesce(attachments,'[]'::jsonb)) file
    where lower(file->>'name')=any($4::text[])
      or ($5 and previous.id=(select id from latest_brief) and coalesce(file->>'kind','text')='text')
    order by lower(file->>'name'),created_at desc,previous.id desc
  `, [input.buildId, userId, projectId, missing.map(function lower(name) { return name.toLowerCase(); }), supplied.data.length === 0]);

  const recovered = result.rows.map(function attachment(row) { return row.attachment; });
  // Images bind to a model at admission. An old client must resubmit an image
  // through that path, rather than adding unseen pixels after model selection.
  if (recovered.some(isImageAttachment)) {
    throw new BuildBriefError("This request refers to an earlier image. Restore the original draft and attach its image before retrying.");
  }
  const merged = BuildAttachmentsSchema.safeParse([...recovered.filter(function absent(file) {
    return !present.has(file.name.toLowerCase());
  }), ...supplied.data]);
  if (!merged.success) {
    throw new BuildBriefError(`The saved brief exceeds the attachment limits. Attach the files needed for this change. ${merged.error.issues[0]?.message ?? ""}`.trim());
  }
  return { ...contextual, attachments: merged.data, restoredBriefs: recovered.map(function name(file) { return file.name; }) };
}
