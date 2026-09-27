import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { erc20Abi } from "viem";
import { APPS_DOMAIN } from "@/lib/config";
import {
  directorySitemap,
  getPublicApp,
  listPublicApps,
  listLatestPublicApps,
  ownerListing,
  reviewListing,
  saveListing,
  unlistApp,
} from "./directory";
import { ListingInput, directoryQuery } from "./validation";
import type { TokenEvidence } from "./types";

test("listing input keeps public prose bounded and rejects markup/control text", function validation() {
  const base = {
    title: "Counter",
    summary: "Count button presses in your browser.",
    description:
      "Open the counter and press Add one to increase its value. This web app is a small public demonstration.",
    tokenContractId: null,
    action: "submit",
    version: 0,
  };
  assert.equal(ListingInput.safeParse(base).success, true);
  for (const title of [
    "<script>x</script>",
    "Wrong\u202Etitle",
    "a".repeat(61),
    "hi",
  ])
    assert.equal(ListingInput.safeParse({ ...base, title }).success, false);
  assert.deepEqual(directoryQuery(new URLSearchParams("page=-1&q=counter")), {
    q: "counter",
    page: 1,
  });
  assert.equal(directoryQuery(new URLSearchParams("page=9999")).page, 1000);
});

test(
  "directory consent, moderation, version and token boundaries use real transactions",
  { skip: !process.env.FLETCH_TEST_DATABASE_URL },
  async function integration(t) {
    const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    const admin = new Pool({ connectionString: url.toString() });
    const namespace = `directory_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`create schema ${namespace}`);
    url.searchParams.set("options", `-c search_path=${namespace},public`);
    const database = new Pool({ connectionString: url.toString(), max: 4 });
    t.after(async function cleanup() {
      await database.end();
      await admin.query(`drop schema ${namespace} cascade`);
      await admin.end();
    });
    for (const table of [
      "user",
      "projects",
      "builds",
      "contracts",
      "audit_log",
    ])
      await database.query(
        `create table "${table}" (like public."${table}" including all)`,
      );
    for (const migration of ["0066_site_drafts.sql", "0067_app_directory.sql", "0070_listing_slugs.sql"])
      await database.query(await readFile(`drizzle/${migration}`, "utf8"));
    const owner = randomUUID();
    await database.query('insert into "user"(id) values($1)', [owner]);
    const operator = { userId: null, name: "controlled-reviewer" };
    const input = {
      title: "Pocket Counter",
      summary: "Count button presses in your browser.",
      description:
        "Open the counter and press Add one to increase its value. This app is a small public demonstration with no wallet needed.",
      tokenContractId: null,
      action: "submit" as const,
      version: 0,
    };
    const options = {
      database,
      legacyRelease: async function none(): Promise<null> {
        return null;
      },
    };

    async function fixture(
      hosted = true,
    ): Promise<{ id: string; slug: string; publicSlug: string; buildId: string }> {
      const id = randomUUID();
      const slug = `test-${id}`;
      const buildId = randomUUID();
      await database.query(
        "insert into projects(id,user_id,slug,name,preview_url) values($1,$2,$3,'PRIVATE_PROJECT_NAME',$4)",
        [id, owner, slug, hosted ? `https://${slug}.${APPS_DOMAIN}` : null],
      );
      await database.query(
        "insert into builds(id,user_id,project_id,prompt,status) values($1,$2,$3,'SECRET_PROMPT_MUST_STAY_PRIVATE','succeeded')",
        [buildId, owner, id],
      );
      if (hosted) await publishedVersion(id, slug, buildId);
      return { id, slug, buildId, publicSlug: `pocket-counter-${id.replaceAll("-", "").slice(0, 8)}` };
    }

    async function publishedVersion(
      id: string,
      slug: string,
      buildId: string,
    ): Promise<void> {
      await database.query(
        "insert into site_drafts(build_id,project_id,slug,manifest,bytes) values($1,$2,$3,'[]',10)",
        [buildId, id, slug],
      );
      await database.query(
        "insert into site_publications(build_id,project_id,state,finished_at) values($1,$2,'published',clock_timestamp())",
        [buildId, id],
      );
    }

    async function approve(id: string): Promise<void> {
      const row = (await ownerListing(owner, id, database))!.listing!;
      await reviewListing(operator, id, row.version, "approve", "", database);
    }

    await t.test(
      "a public host alone grants no directory access; owner scope is enforced",
      async function scope() {
        const app = await fixture();
        assert.equal(await getPublicApp(app.slug, database), null);
        assert.equal(
          await ownerListing("another-wallet", app.id, database),
          null,
        );
        await assert.rejects(
          saveListing("another-wallet", app.id, input, options),
          /Project not found/,
        );
        await assert.rejects(
          unlistApp("another-wallet", app.id, database),
          /Project not found/,
        );
        assert.deepEqual(await directorySitemap(database), []);
      },
    );

    await t.test(
      "private draft and pending review stay private; explicit approval exposes only public fields",
      async function lifecycle() {
        const app = await fixture();
        await saveListing(owner, app.id, { ...input, action: "save" }, options);
        await assert.rejects(approve(app.id), /owner-submitted/);
        assert.equal(await getPublicApp(app.slug, database), null);
        await saveListing(owner, app.id, { ...input, version: 1 }, options);
        assert.equal(await getPublicApp(app.slug, database), null);
        await approve(app.id);
        const visible = await getPublicApp(app.slug, database);
        assert.equal(visible?.title, input.title);
        assert.equal(JSON.stringify(visible).includes("PRIVATE"), false);
        assert.equal("projectId" in visible!, false);
        assert.equal(
          (await listPublicApps("counter", 1, database)).apps.some(
            (row) => row.slug === app.publicSlug,
          ),
          true,
        );
        assert.equal(
          (await directorySitemap(database)).some(
            (row) => row.slug === app.publicSlug,
          ),
          true,
        );
        await unlistApp(owner, app.id, database);
        assert.equal(await getPublicApp(app.slug, database), null);
        assert.equal(
          (await directorySitemap(database)).some(
            (row) => row.slug === app.publicSlug,
          ),
          false,
        );
        assert.equal(
          (await ownerListing(owner, app.id, database))?.project.liveUrl,
          `https://${app.slug}.${APPS_DOMAIN}`,
        );
      },
    );

    await t.test("custom slugs retain aliases, reject another owner's claim and obey review and withdrawal", async function aliases() {
      const app = await fixture();
      await saveListing(owner, app.id, { ...input, slug: "original-raffle" }, options);
      await approve(app.id);
      assert.equal((await getPublicApp(app.slug, database))?.slug, "original-raffle");
      const current = (await ownerListing(owner, app.id, database))!;
      await saveListing(owner, app.id, { ...input, slug: "renamed-raffle", version: current.listing!.version }, options);
      assert.equal(await getPublicApp("original-raffle", database), null);
      assert.equal(await getPublicApp("renamed-raffle", database), null);
      await approve(app.id);
      assert.equal((await getPublicApp("original-raffle", database))?.slug, "renamed-raffle");
      assert.equal((await getPublicApp(app.slug, database))?.liveUrl, `https://${app.slug}.${APPS_DOMAIN}`);
      const other = await fixture();
      await assert.rejects(saveListing(owner, other.id, { ...input, slug: "original-raffle" }, options), /already taken/);
      await assert.rejects(saveListing(randomUUID(), app.id, { ...input, slug: "stolen-raffle" }, options), /not found/);
      const map = await directorySitemap(database);
      assert.ok(map.some((row) => row.slug === "renamed-raffle"));
      assert.equal(map.some((row) => row.slug === "original-raffle" || row.slug === app.slug), false);
      await unlistApp(owner, app.id, database);
      for (const slug of [app.slug, "original-raffle", "renamed-raffle"]) assert.equal(await getPublicApp(slug, database), null);
      assert.equal((await directorySitemap(database)).some((row) => row.slug === "renamed-raffle"), false);
    });

    await t.test("existing approved titles get stable named slugs without changing consent or hosting", async function migration() {
      const app = await fixture();
      await saveListing(owner, app.id, input, options);
      await approve(app.id);
      await database.query("update app_listings set public_slug=null,title='ETH Raffle' where project_id=$1", [app.id]);
      const before = (await ownerListing(owner, app.id, database))!;
      const migration = await readFile("drizzle/0070_listing_slugs.sql", "utf8");
      await database.query(migration);
      await database.query(migration);
      const after = (await ownerListing(owner, app.id, database))!;
      assert.equal(after.listing?.slug, "eth-raffle");
      assert.equal(after.listing?.state, "approved");
      assert.equal(after.listing?.version, before.listing?.version);
      assert.equal(after.project.liveUrl, before.project.liveUrl);
      assert.equal((await getPublicApp(app.slug, database))?.slug, "eth-raffle");
      await unlistApp(owner, app.id, database);
    });

    await t.test("homepage reads the newest six and immediately removes withdrawn listings", async function latest() {
      const fixtures = [];
      for (let index = 0; index < 8; index++) {
        const app = await fixture();
        fixtures.push(app);
        await saveListing(owner, app.id, input, options);
        await approve(app.id);
        await database.query("update app_listings set first_listed_at=$2,featured=$3 where project_id=$1", [app.id, new Date(1_700_000_000_000 + index * 1000), index === 0]);
      }
      assert.deepEqual((await listLatestPublicApps(database)).map((app) => app.slug), fixtures.slice(2).reverse().map((app) => app.publicSlug));
      await unlistApp(owner, fixtures[7].id, database);
      assert.deepEqual((await listLatestPublicApps(database)).map((app) => app.slug), fixtures.slice(1, 7).reverse().map((app) => app.publicSlug));
      for (const app of fixtures.slice(0, 7)) await unlistApp(owner, app.id, database);
      assert.deepEqual(await listLatestPublicApps(database), []);
    });

    await t.test(
      "an unpublished preview can save a private draft but cannot be submitted",
      async function preview() {
        const app = await fixture(false);
        await assert.rejects(
          saveListing(owner, app.id, input, options),
          /Publish the app/,
        );
        await saveListing(owner, app.id, { ...input, action: "save" }, options);
        assert.equal(
          (await ownerListing(owner, app.id, database))?.listing?.state,
          "draft",
        );
      },
    );

    await t.test(
      "a changed live build disappears and an old review cannot approve it",
      async function changedBuild() {
        const app = await fixture();
        await saveListing(owner, app.id, input, options);
        await approve(app.id);
        const next = randomUUID();
        await database.query(
          "insert into builds(id,user_id,project_id,prompt,status) values($1,$2,$3,'Private change','succeeded')",
          [next, owner, app.id],
        );
        await publishedVersion(app.id, app.slug, next);
        assert.equal(await getPublicApp(app.slug, database), null);
        assert.equal(
          (await ownerListing(owner, app.id, database))?.needsReview,
          true,
        );
        await saveListing(owner, app.id, { ...input, version: 2 }, options);
        await approve(app.id);
        assert.ok(await getPublicApp(app.slug, database));
        await unlistApp(owner, app.id, database);
      },
    );

    await t.test(
      "simultaneous edits have one winner and withdrawal defeats concurrent approval",
      async function races() {
        const app = await fixture();
        const saves = await Promise.allSettled([
          saveListing(owner, app.id, input, options),
          saveListing(owner, app.id, input, options),
        ]);
        assert.equal(
          saves.filter((row) => row.status === "fulfilled").length,
          1,
        );
        await Promise.allSettled([
          approve(app.id),
          unlistApp(owner, app.id, database),
        ]);
        assert.equal(await getPublicApp(app.slug, database), null);
        assert.equal(
          (await ownerListing(owner, app.id, database))?.listing?.optedIn,
          false,
        );
      },
    );

    await t.test(
      "suspension requires admin reopening and fresh owner consent",
      async function moderation() {
        const app = await fixture();
        await saveListing(owner, app.id, input, options);
        await approve(app.id);
        await reviewListing(
          operator,
          app.id,
          2,
          "suspend",
          "Revise misleading claims.",
          database,
        );
        assert.equal(await getPublicApp(app.slug, database), null);
        await assert.rejects(
          saveListing(owner, app.id, { ...input, version: 3 }, options),
          /admin has hidden/,
        );
        await reviewListing(
          operator,
          app.id,
          3,
          "reopen",
          "Ready for resubmission.",
          database,
        );
        await assert.rejects(approve(app.id), /owner-submitted/);
        await saveListing(owner, app.id, { ...input, version: 4 }, options);
        await approve(app.id);
        await database.query('update "user" set banned=true where id=$1', [
          owner,
        ]);
        assert.equal(await getPublicApp(app.slug, database), null);
        await database.query('update "user" set banned=false where id=$1', [
          owner,
        ]);
        await database.query(
          "insert into audit_log(id,actor_type,action) values($1,'user','project.delete_requested')",
          [`project-delete:${app.id}`],
        );
        assert.equal(await getPublicApp(app.slug, database), null);
      },
    );

    await t.test("a later token becomes selectable without becoming public before publication, consent and review", async function laterToken() {
      const app = await fixture();
      await saveListing(owner, app.id, input, options);
      await approve(app.id);
      assert.deepEqual((await ownerListing(owner, app.id, database))?.contracts, []);
      const buildId = randomUUID();
      const tokenId = randomUUID();
      const address = `0x${"34".repeat(20)}`;
      await database.query("update builds set created_at=clock_timestamp()-interval '1 hour' where id=$1", [app.buildId]);
      await database.query("insert into builds(id,user_id,project_id,prompt,status) values($1,$2,$3,'Add a token','failed')", [buildId, owner, app.id]);
      await database.query("insert into contracts(id,build_id,chain_id,address,abi) values($1,$2,46630,$3,$4)", [tokenId, buildId, address, JSON.stringify(erc20Abi)]);
      assert.deepEqual((await ownerListing(owner, app.id, database))?.contracts, []);
      await database.query("update builds set status='succeeded' where id=$1", [buildId]);
      const updated = (await ownerListing(owner, app.id, database))!;
      assert.equal(updated.contracts.length, 1);
      assert.equal(updated.contracts[0].id, tokenId);
      assert.equal(updated.contracts[0].buildId, buildId);
      assert.equal(updated.contracts[0].published, false);
      assert.equal((await getPublicApp(app.slug, database))?.token, null);
      const evidence: TokenEvidence = { chainId: 46630, address, name: "Game Token", symbol: "GAME", decimals: 18, totalSupply: "100", blockNumber: "101", checkedAt: new Date().toISOString(), sourceVerified: false, sourceVerifiedAt: null };
      const selected = { ...input, tokenContractId: tokenId, version: updated.listing!.version };
      const tokenOptions = { ...options, validate: async function read(): Promise<TokenEvidence> { return evidence; } };
      await assert.rejects(saveListing(owner, app.id, selected, tokenOptions), /Publish the build that contains this token/);
      await publishedVersion(app.id, app.slug, buildId);
      assert.equal((await ownerListing(owner, app.id, database))?.contracts[0].published, true);
      assert.equal(await getPublicApp(app.slug, database), null);
      await saveListing(owner, app.id, selected, tokenOptions);
      assert.equal(await getPublicApp(app.slug, database), null);
      await approve(app.id);
      assert.equal((await getPublicApp(app.slug, database))?.token?.symbol, "GAME");
    });

    await t.test(
      "token evidence must belong to this project's published version and failures stay private",
      async function tokens() {
        const app = await fixture();
        const other = await fixture();
        const tokenId = randomUUID();
        const address = `0x${"12".repeat(20)}`;
        await database.query(
          "insert into contracts(id,build_id,chain_id,address,abi) values($1,$2,46630,$3,$4)",
          [tokenId, app.buildId, address, JSON.stringify(erc20Abi)],
        );
        const evidence: TokenEvidence = {
          chainId: 46630,
          address,
          name: "Controlled Token",
          symbol: "TEST",
          decimals: 18,
          totalSupply: "100",
          blockNumber: "99",
          checkedAt: new Date().toISOString(),
          sourceVerified: false,
          sourceVerifiedAt: null,
        };
        let reads = 0;
        const tokenOptions = {
          ...options,
          validate: async function read(): Promise<TokenEvidence> {
            reads++;
            return evidence;
          },
        };
        await assert.rejects(
          saveListing(
            owner,
            other.id,
            { ...input, tokenContractId: tokenId },
            tokenOptions,
          ),
          /Choose a token recorded/,
        );
        assert.equal(reads, 0);
        await assert.rejects(
          saveListing(
            owner,
            app.id,
            { ...input, tokenContractId: tokenId },
            {
              ...options,
              validate: async function fail(): Promise<never> {
                throw new Error("Controlled RPC failure");
              },
            },
          ),
          /token check could not/,
        );
        assert.equal(
          (await ownerListing(owner, app.id, database))?.listing,
          null,
        );
        await saveListing(
          owner,
          app.id,
          { ...input, tokenContractId: tokenId },
          tokenOptions,
        );
        await approve(app.id);
        assert.deepEqual(
          (await getPublicApp(app.slug, database))?.token,
          evidence,
        );
        assert.equal(reads, 1);
        for (const query of ["TEST", "$test", address]) {
          assert.ok((await listPublicApps(query, 1, database)).apps.some(function matched(entry) { return entry.slug === app.publicSlug; }));
        }
        await unlistApp(owner, app.id, database);
        assert.equal((await listPublicApps("$TEST", 1, database)).apps.length, 0);
        await database.query("delete from projects where id=$1", [app.id]);
        assert.equal(await getPublicApp(app.slug, database), null);
        assert.equal(
          (
            await database.query(
              "select 1 from app_listings where project_id=$1",
              [app.id],
            )
          ).rowCount,
          0,
        );
      },
    );
  },
);
