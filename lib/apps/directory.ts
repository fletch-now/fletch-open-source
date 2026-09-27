import "server-only";
import { join } from "node:path";
import { workspaceRoot } from "@/lib/build/workspace";
import { appMetadata, readGeneratedAppMetadata } from "./generated-metadata";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { pool } from "@/lib/db";
import { APPS_DOMAIN } from "@/lib/config";
import { readDraftFile, type SiteDraft } from "@/lib/hosting/drafts";
import { currentRelease } from "@/lib/hosting/publish";
import { isTokenAbi, type ListingInput } from "./validation";
import { suggestListingSlug, validListingSlug } from "./slug";
import { validateToken, type RecordedToken } from "./token";
import type {
  AppListing,
  ListingState,
  OwnerListing,
  PublicApp,
  TokenEvidence,
} from "./types";

export class ListingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface ListingRow {
  project_id: string;
  public_slug: string | null;
  title: string;
  summary: string;
  description: string;
  opted_in: boolean;
  state: ListingState;
  version: number;
  build_id: string | null;
  token_contract_id: string | null;
  token_evidence: TokenEvidence | null;
  featured: boolean;
  review_note: string | null;
  submitted_at: Date | null;
  first_listed_at: Date | null;
  updated_at: Date;
}
interface PublicRow extends ListingRow {
  slug: string;
  preview_url: string;
}
interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  preview_url: string | null;
}
interface TokenRow extends RecordedToken {
  abi: unknown;
  created_at: Date;
  build_id: string;
  published: boolean;
}

const CURRENT_BUILD = `(select sp.build_id from site_publications sp where sp.project_id=p.id and sp.state='published' order by sp.finished_at desc,sp.build_id desc limit 1)`;
// Read authorization is evaluated on every surface, including images and the
// sitemap. A new published version needs review before the listing returns.
const PUBLIC = `l.opted_in and l.state='approved' and not coalesce(u.banned,false)
  and p.preview_url='https://' || p.slug || '.' || $1
  and l.build_id is not null and l.build_id=coalesce(${CURRENT_BUILD},l.build_id)
  and not exists(select 1 from site_publications sp where sp.project_id=p.id and sp.state='publishing')
  and not exists(select 1 from audit_log a where a.id='project-delete:' || p.id)`;
const JOINS = `from app_listings l join projects p on p.id=l.project_id join "user" u on u.id=p.user_id`;

function listing(row: ListingRow): AppListing {
  return {
    projectId: row.project_id,
    slug: row.public_slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    optedIn: row.opted_in,
    state: row.state,
    version: row.version,
    buildId: row.build_id,
    tokenContractId: row.token_contract_id,
    token: row.token_contract_id ? row.token_evidence : null,
    featured: row.featured,
    reviewNote: row.review_note,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    firstListedAt: row.first_listed_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
  };
}

function publicApp(row: PublicRow): PublicApp {
  return {
    slug: row.public_slug ?? row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    liveUrl: row.preview_url,
    token: row.token_contract_id ? row.token_evidence : null,
    featured: row.featured,
    listedAt: row.first_listed_at!.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export const DIRECTORY_PAGE_SIZE = 24;

export async function listLatestPublicApps(database: Pool = pool): Promise<PublicApp[]> {
  const rows = await database.query<PublicRow>(
    `select l.*,p.slug,p.preview_url ${JOINS} where ${PUBLIC}
     order by l.first_listed_at desc,l.project_id limit 6`,
    [APPS_DOMAIN],
  );
  return rows.rows.map(publicApp);
}

export async function listPublicApps(
  q = "",
  page = 1,
  database: Pool = pool,
): Promise<{ apps: PublicApp[]; page: number; hasMore: boolean }> {
  const offset =
    (Math.max(1, Math.min(1000, Math.floor(page))) - 1) * DIRECTORY_PAGE_SIZE;
  const rows = (
    await database.query<PublicRow>(
      `select l.*,p.slug,p.preview_url ${JOINS} where ${PUBLIC}
    and ($2='' or l.search_document @@ websearch_to_tsquery('simple',$2)
      or lower(l.token_evidence->>'symbol')=lower(ltrim($2,'$'))
      or lower(l.token_evidence->>'address')=lower($2))
    order by l.featured desc,l.first_listed_at desc,l.project_id limit $3 offset $4`,
      [APPS_DOMAIN, q.slice(0, 80), DIRECTORY_PAGE_SIZE + 1, offset],
    )
  ).rows;
  return {
    apps: rows.slice(0, DIRECTORY_PAGE_SIZE).map(publicApp),
    page,
    hasMore: page < 1000 && rows.length > DIRECTORY_PAGE_SIZE,
  };
}

export async function getPublicApp(
  slug: string,
  database: Pool = pool,
): Promise<PublicApp | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) return null;
  const row = (
    await database.query<PublicRow>(
      `select l.*,p.slug,p.preview_url ${JOINS} where ${PUBLIC}
       and (p.slug=$2 or exists(select 1 from app_listing_slugs s where s.project_id=p.id and s.slug=$2))`,
      [APPS_DOMAIN, slug],
    )
  ).rows[0];
  return row ? publicApp(row) : null;
}

export async function directorySitemap(
  database: Pool = pool,
  page = 0,
  size = 10_000,
): Promise<{ slug: string; updatedAt: Date }[]> {
  return (
    await database.query<{ slug: string; updatedAt: Date }>(
      `select coalesce(l.public_slug,p.slug) as slug,l.updated_at as "updatedAt" ${JOINS} where ${PUBLIC} order by l.project_id limit $2 offset $3`,
      [APPS_DOMAIN, size, page * size],
    )
  ).rows;
}

export async function directorySitemapCount(database: Pool = pool): Promise<number> {
  const result = await database.query<{ count: string }>(`select count(*) as count ${JOINS} where ${PUBLIC}`, [APPS_DOMAIN]);
  return Number(result.rows[0].count);
}

async function projectTokens(
  projectId: string,
  database: Pool,
): Promise<TokenRow[]> {
  const rows = (
    await database.query<TokenRow>(
      `select distinct on(c.chain_id,lower(c.address)) c.*,
      exists(select 1 from site_publications sp join builds live on live.id=sp.build_id
        where sp.project_id=b.project_id and sp.state='published' and live.created_at>=b.created_at) as published
      from contracts c join builds b on b.id=c.build_id
      where b.project_id=$1 and b.status='succeeded' order by c.chain_id,lower(c.address),c.created_at desc`,
      [projectId],
    )
  ).rows;
  return rows.filter(function token(row) {
    return isTokenAbi(row.abi);
  });
}

async function listingSuggestion(project: ProjectRow, database: Pool) {
  const draft = (await database.query<SiteDraft>(
    `select d.* from site_drafts d join builds b on b.id=d.build_id
     where d.project_id=$1 and b.status='succeeded' order by d.created_at desc limit 1`, [project.id],
  )).rows[0];
  if (draft) {
    const frozen = await readDraftFile(draft, ["fletch-share.json"]).catch(() => null);
    if (frozen) {
      try {
        const data = JSON.parse(frozen.toString("utf8"));
        return appMetadata(JSON.stringify({ ...data, name: data.title }), null, project.name);
      } catch { /* Older previews can use their HTML description. */ }
    }
    const html = await readDraftFile(draft, ["index.html"]).catch(() => null);
    if (html) return appMetadata(null, html.toString("utf8"), project.name);
  }
  // Legacy hosted apps have no saved preview. Avoid reading an active edit.
  const active = await database.query("select 1 from builds where project_id=$1 and status in ('queued','provisioning','building','compiling','paused') limit 1", [project.id]);
  if (project.preview_url && !active.rowCount) return readGeneratedAppMetadata(join(workspaceRoot(), project.slug), project.name);
  return appMetadata(null, null, project.name);
}

export async function ownerListing(
  userId: string,
  projectId: string,
  database: Pool = pool,
): Promise<OwnerListing | null> {
  const project = (
    await database.query<ProjectRow>(
      "select id,slug,name,preview_url from projects where id=$1 and user_id=$2",
      [projectId, userId],
    )
  ).rows[0];
  if (!project) return null;
  const [rows, tokens, visible] = await Promise.all([
    database.query<ListingRow>(
      "select * from app_listings where project_id=$1",
      [projectId],
    ),
    projectTokens(projectId, database),
    getPublicApp(project.slug, database),
  ]);
  const row = rows.rows[0];
  return {
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      liveUrl: project.preview_url,
    },
    suggested: await listingSuggestion(project, database),
    listing: row ? listing(row) : null,
    public: Boolean(visible),
    needsReview: row?.state === "approved" && row.opted_in && !visible,
    contracts: tokens.map(function choice(token) {
      return {
        id: token.id, address: token.address, chainId: token.chain_id,
        buildId: token.build_id, recordedAt: token.created_at.toISOString(), published: token.published,
      };
    }),
  };
}

async function transaction<T>(
  database: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (cause) {
    await client.query("rollback");
    throw cause;
  } finally {
    client.release();
  }
}

async function audit(
  client: PoolClient,
  actor: string | null,
  action: string,
  projectId: string,
  metadata: object,
): Promise<void> {
  await client.query(
    `insert into audit_log(id,user_id,actor_type,action,resource_type,resource_id,metadata)
    values($1,$2,'user',$3,'project',$4,$5)`,
    [`al_${randomUUID()}`, actor, action, projectId, JSON.stringify(metadata)],
  );
}

async function lockProject(
  client: PoolClient,
  projectId: string,
  userId?: string,
): Promise<ProjectRow> {
  const row = (
    await client.query<ProjectRow>(
      "select id,slug,name,preview_url from projects where id=$1 and ($2::text is null or user_id=$2) for update",
      [projectId, userId ?? null],
    )
  ).rows[0];
  if (!row) throw new ListingError("Project not found.", 404);
  if (
    (
      await client.query("select 1 from audit_log where id=$1", [
        `project-delete:${projectId}`,
      ])
    ).rows.length
  ) {
    throw new ListingError("This project is being deleted.", 409);
  }
  return row;
}

async function publishedBuild(
  client: PoolClient,
  project: ProjectRow,
  legacyBuild: string | null,
): Promise<string> {
  if (project.preview_url !== `https://${project.slug}.${APPS_DOMAIN}`)
    throw new ListingError(
      "Publish the app before submitting its directory listing.",
      409,
    );
  if (
    (
      await client.query(
        "select 1 from site_publications where project_id=$1 and state='publishing'",
        [project.id],
      )
    ).rows.length
  ) {
    throw new ListingError(
      "Publication is in progress. Submit the listing when it finishes.",
      409,
    );
  }
  const rows = await client.query<{ build_id: string }>(
    "select build_id from site_publications where project_id=$1 and state='published' order by finished_at desc,build_id desc limit 1",
    [project.id],
  );
  const id = rows.rows[0]?.build_id ?? legacyBuild;
  const build = await client.query(
    "select id from builds where id=$1 and project_id=$2 and status='succeeded'",
    [id, project.id],
  );
  if (!id || !build.rows.length)
    throw new ListingError(
      "A confirmed published build is required. Open the builder to publish a saved preview.",
      409,
    );
  return id;
}

interface SaveOptions {
  database?: Pool;
  validate?: typeof validateToken;
  legacyRelease?: typeof currentRelease;
}

async function reserveListingSlug(client: PoolClient, project: ProjectRow, desired: string): Promise<void> {
  const collision = await client.query("select 1 from projects where slug=$1 and id<>$2", [desired, project.id]);
  if (collision.rows.length) throw new ListingError("This listing address is already taken. Choose another name.", 409);
  const result = await client.query<{ project_id: string }>(
    `insert into app_listing_slugs(slug,project_id) values($1,$2)
     on conflict(slug) do update set slug=excluded.slug where app_listing_slugs.project_id=excluded.project_id
     returning project_id`, [desired, project.id]);
  if (!result.rows.length) throw new ListingError("This listing address is already taken. Choose another name.", 409);
}

export async function saveListing(
  userId: string,
  projectId: string,
  input: ListingInput,
  options: SaveOptions = {},
): Promise<void> {
  const database = options.database ?? pool;
  const owner = await ownerListing(userId, projectId, database);
  if (!owner) throw new ListingError("Project not found.", 404);
  if ((owner.listing?.version ?? 0) !== input.version)
    throw new ListingError(
      "This listing changed in another tab. Reload it before saving.",
      409,
    );
  if (owner.listing?.state === "suspended")
    throw new ListingError(
      "An admin has hidden this listing. Contact Fletch to request a review.",
      409,
    );
  const record = (await projectTokens(projectId, database)).find(
    function selected(row) {
      return row.id === input.tokenContractId;
    },
  );
  if (input.tokenContractId && !record)
    throw new ListingError("Choose a token recorded for this project.", 400);
  let evidence: TokenEvidence | null = null;
  if (record) {
    try {
      evidence = await (options.validate ?? validateToken)(record);
    } catch {
      throw new ListingError(
        "The token check could not be completed. Try again when the chain responds; this listing has not been submitted.",
        422,
      );
    }
  }
  const legacy = await (options.legacyRelease ?? currentRelease)(
    owner.project.slug,
  );
  await transaction(database, async function save(client) {
    await client.query('select id from "user" where id=$1 for update', [
      userId,
    ]);
    const project = await lockProject(client, projectId, userId);
    const current = (
      await client.query<ListingRow>(
        "select * from app_listings where project_id=$1 for update",
        [projectId],
      )
    ).rows[0];
    if ((current?.version ?? 0) !== input.version)
      throw new ListingError(
        "This listing changed in another tab. Reload it before saving.",
        409,
      );
    // Keep the old hosting URL as an alias. Slug changes never rename a hosted app.
    await reserveListingSlug(client, project, project.slug);
    let publicSlug = input.slug ?? current?.public_slug;
    if (!publicSlug) publicSlug = `${suggestListingSlug(input.title).slice(0, 40)}-${project.id.replaceAll("-", "").slice(0, 8)}`;
    if (!validListingSlug(publicSlug)) throw new ListingError("Choose a valid listing address.", 400);
    await reserveListingSlug(client, project, publicSlug);
    const submit = input.action === "submit";
    const buildId = submit
      ? await publishedBuild(client, project, legacy)
      : null;
    if (record && buildId) {
      const belongs = await client.query(
        `select 1 from contracts c join builds b on b.id=c.build_id join builds live on live.id=$3
        where c.id=$1 and b.project_id=$2 and b.created_at<=live.created_at`,
        [record.id, projectId, buildId],
      );
      if (!belongs.rows.length)
        throw new ListingError(
          "Publish the build that contains this token before submitting it.",
          409,
        );
    }
    await client.query(
      `insert into app_listings(project_id,title,summary,description,opted_in,state,build_id,token_contract_id,token_evidence,submitted_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,case when $5 then clock_timestamp() end)
      on conflict(project_id) do update set title=$2,summary=$3,description=$4,opted_in=$5,state=$6,build_id=$7,token_contract_id=$8,token_evidence=$9,
      version=app_listings.version+1,featured=false,review_note=null,reviewed_at=null,submitted_at=case when $5 then clock_timestamp() end,updated_at=clock_timestamp()`,
      [
        projectId,
        input.title,
        input.summary,
        input.description,
        submit,
        submit ? "pending" : "draft",
        buildId,
        record?.id ?? null,
        evidence ? JSON.stringify(evidence) : null,
      ],
    );
    await client.query("update app_listings set public_slug=$2 where project_id=$1", [projectId, publicSlug]);
    await audit(
      client,
      userId,
      submit ? "app.listing.submitted" : "app.listing.saved",
      projectId,
      { version: input.version + 1, buildId },
    );
  });
}

export async function unlistApp(
  userId: string,
  projectId: string,
  database: Pool = pool,
): Promise<void> {
  await transaction(database, async function unlist(client) {
    await client.query('select id from "user" where id=$1 for update', [
      userId,
    ]);
    await lockProject(client, projectId, userId);
    await client.query(
      `update app_listings set opted_in=false,state=case when state='suspended' then 'suspended' else 'draft' end,
      featured=false,version=version+1,updated_at=clock_timestamp() where project_id=$1`,
      [projectId],
    );
    await audit(client, userId, "app.listing.unlisted", projectId, {});
  });
}

export async function adminListings(
  state: string,
  page = 1,
  database: Pool = pool,
): Promise<
  (AppListing & { slug: string; liveUrl: string | null; public: boolean })[]
> {
  const rows = (
    await database.query<PublicRow & { visible: boolean }>(
      `select l.*,p.slug,p.preview_url,(${PUBLIC}) as visible ${JOINS}
    where ($2='all' or l.state=$2) order by l.updated_at desc limit 51 offset $3`,
      [APPS_DOMAIN, state, (Math.max(1, Math.min(1000, page)) - 1) * 50],
    )
  ).rows;
  return rows.map(function item(row) {
    return {
      ...listing(row),
      slug: row.public_slug ?? row.slug,
      liveUrl: row.preview_url,
      public: row.visible,
    };
  });
}

export type ReviewAction =
  | "approve"
  | "reject"
  | "suspend"
  | "reopen"
  | "feature"
  | "unfeature";

export async function reviewListing(
  actor: { userId: string | null; name: string },
  projectId: string,
  version: number,
  action: ReviewAction,
  note: string,
  database: Pool = pool,
): Promise<void> {
  await transaction(database, async function review(client) {
    const project = await lockProject(client, projectId);
    const row = (
      await client.query<ListingRow>(
        "select * from app_listings where project_id=$1 for update",
        [projectId],
      )
    ).rows[0];
    if (!row) throw new ListingError("Listing not found.", 404);
    if (row.version !== version)
      throw new ListingError(
        "The owner or another admin changed this listing. Reload before reviewing.",
        409,
      );
    if (action === "approve") {
      if (!row.opted_in || row.state !== "pending")
        throw new ListingError(
          "Only an owner-submitted listing can be approved.",
          409,
        );
      const buildId = await publishedBuild(client, project, row.build_id);
      if (row.build_id !== buildId)
        throw new ListingError(
          "A different build is live. The owner needs to resubmit its listing.",
          409,
        );
      await client.query(
        `update app_listings set state='approved',first_listed_at=coalesce(first_listed_at,clock_timestamp()),reviewed_at=clock_timestamp() where project_id=$1`,
        [projectId],
      );
    } else if (action === "feature" || action === "unfeature") {
      if (row.state !== "approved" || !row.opted_in)
        throw new ListingError(
          "Approve an owner-submitted listing before featuring it.",
          409,
        );
      await client.query(
        "update app_listings set featured=$2 where project_id=$1",
        [projectId, action === "feature"],
      );
    } else {
      let state: ListingState = "rejected";
      if (action === "suspend") state = "suspended";
      if (action === "reopen") state = "draft";
      await client.query(
        "update app_listings set state=$2,opted_in=false,featured=false,reviewed_at=clock_timestamp() where project_id=$1",
        [projectId, state],
      );
    }
    await client.query(
      "update app_listings set version=version+1,review_note=$2,updated_at=clock_timestamp() where project_id=$1",
      [projectId, note.trim() || null],
    );
    await audit(client, actor.userId, `admin.app.${action}`, projectId, {
      operator: actor.name,
      version,
      note: note.trim(),
    });
  });
}
