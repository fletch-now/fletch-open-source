import { assertWorkerExecution, currentWorkerExecution, recordWorkerDispatchEvidence, workerOperation } from "@/lib/build/durable/execution";
import { withSiteLock } from "@/lib/hosting/site-lock";
import { buildSignal, withBuildCancellation, checkBuildCancellation } from "@/lib/build/cancellation";
import "server-only";
import { execFile } from "node:child_process";
import { cp, mkdir, readlink, rename, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { APPS_DOMAIN } from "@/lib/config";
import { logEvent } from "@/lib/log";

// Puts a built site at https://<slug>.apps.example.com. Files are copied to a
// per-build directory and `current` is switched with a rename, so a visitor never
// sees a half-copied site and a failed publish never replaces a working one. The
// certificate and the nginx reload need root; a single sudoers-listed script does
// exactly those two things and nothing else (scripts/fletch-publish-site).
//
// The URL is reported only after this process has fetched it over HTTPS and got a
// 200. Every earlier "your dapp is live" that pointed at nothing came from
// skipping that step.

const SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;
const PUBLISH_SCRIPT = "/usr/local/bin/fletch-publish-site";
const SCRIPT_TIMEOUT_MS = 150_000;
const VERIFY_TIMEOUT_MS = 15_000;

export function sitesRoot(): string {
  return process.env.FORGE_SITES_ROOT ?? "/var/lib/fletch/sites";
}

export function siteUrl(slug: string): string {
  return `https://${slug}.${APPS_DOMAIN}`;
}

export type PublishResult = { ok: true; url: string; bytes: number } | { ok: false; error: string };

function runPublishScript(slug: string): Promise<{ code: number; output: string }> {
  checkBuildCancellation();
  return new Promise(function execute(resolve) {
    let result = { code: 1, output: "The certificate process ended without a result." };
    const child = execFile("sudo", ["-n", PUBLISH_SCRIPT, slug], { timeout: SCRIPT_TIMEOUT_MS, signal: buildSignal(), killSignal: "SIGTERM" }, function done(error, stdout, stderr) {
      const output = `${stdout}${stderr}`.trim();
      result = { code: error ? 1 : 0, output: output || error?.message || "" };
    });
    // AbortError arrives before sudo and the helper's children have exited.
    child.on("close", function closed() { resolve(result); });
  });
}

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual", signal: buildSignal(AbortSignal.timeout(VERIFY_TIMEOUT_MS)), cache: "no-store" });
    const ok = response.status === 200;
    await response.body?.cancel();
    return ok;
  } catch {
    return false;
  }
}

// Only regular files travel: the build step already refused a dist with links,
// and this copy refuses to follow one either way.
async function copySite(from: string, to: string): Promise<void> {
  await cp(from, to, {
    recursive: true,
    dereference: false,
    filter: function regularOnly(source) {
      checkBuildCancellation();
      return !source.split("/").some((segment) => segment.startsWith("."));
    },
  });
}

interface PublishOptions { previousRelease?: string | null }

async function publishSiteInternal(slug: string, buildId: string, distDir: string, bytes: number, options: PublishOptions): Promise<PublishResult> {
  if (currentWorkerExecution()?.signal.aborted) return { ok: false, error: "Stopped before publication." };
  checkBuildCancellation();
  if (!SLUG.test(slug)) {
    return { ok: false, error: "Project slug is not a valid host name." };
  }
  const siteDir = join(sitesRoot(), slug);
  const releaseDir = join(siteDir, buildId);
  const current = join(siteDir, "current");
  const swap = join(siteDir, `current.${buildId}`);
  const observed = await currentRelease(slug);
  const url = siteUrl(slug);
  if (observed === buildId && await reachable(url)) {
    checkBuildCancellation();
    await assertWorkerExecution();
    return { ok: true, url, bytes };
  }
  const previous = options.previousRelease === undefined ? observed : options.previousRelease;
  let confirmed = false;
  try {
    await recordWorkerDispatchEvidence("publication_prepared", { slug, buildId, previousRelease: previous });
    await mkdir(siteDir, { recursive: true, mode: 0o755 });
    // A recovered publication can already be serving this immutable directory.
    if (observed !== buildId) {
      await rm(releaseDir, { recursive: true, force: true });
      await copySite(distDir, releaseDir);
    }
    // A relative link, so the tree can move as a whole and still resolve.
    checkBuildCancellation();
    await rm(swap, { force: true });
    await symlink(buildId, swap);
    checkBuildCancellation();
    await assertWorkerExecution();
    await rename(swap, current);

    await assertWorkerExecution();
    const script = await runPublishScript(slug);
    if (script.code !== 0) {
      logEvent("hosting", { event: "publish-script-failed", slug, output: script.output.slice(0, 500) });
      return { ok: false, error: "Publication was not confirmed because the certificate step failed. Any previous release was retained; an operator has the log." };
    }

    if (!(await reachable(url))) {
      logEvent("hosting", { event: "verify-failed", slug, url });
      return { ok: false, error: `Publication was not confirmed because ${url} did not answer successfully. Any previous release was retained.` };
    }
    logEvent("hosting", { event: "published", slug, buildId, bytes, url });
    checkBuildCancellation();
    confirmed = true;
    return { ok: true, url, bytes };
  } catch (cause) {
    await rm(swap, { force: true }).catch(function ignore() {});
    if (!currentWorkerExecution()) checkBuildCancellation();
    return { ok: false, error: `Could not publish the site: ${cause instanceof Error ? cause.message : String(cause)}` };
  } finally {
    if (!confirmed && await currentRelease(slug) === buildId) {
      if (previous) {
        await rm(swap, { force: true });
        await symlink(previous, swap);
        await rename(swap, current);
      } else {
        await rm(current, { force: true });
      }
    }
  }
}

// What `current` points at, for the project page and the admin console.
export async function currentRelease(slug: string): Promise<string | null> {
  return readlink(join(sitesRoot(), slug, "current")).catch(function missing(cause: NodeJS.ErrnoException) {
    if (cause.code === "ENOENT") return null;
    throw cause;
  });
}

// Takedown: `current` goes away, nginx serves 404 for the host, releases stay on
// disk for the audit trail until the reaper's age sweep removes them.
export async function unpublishSite(slug: string): Promise<void> {
  if (!SLUG.test(slug)) {
    return;
  }
  await withSiteLock(sitesRoot(), slug, async function remove(signal) {
    signal.throwIfAborted();
    await rm(join(sitesRoot(), slug, "current"), { force: true });
  });
}

export async function publishSite(slug: string, buildId: string, distDir: string, bytes: number, options: PublishOptions = {}): Promise<PublishResult> {
  checkBuildCancellation();
  if (!SLUG.test(slug)) return { ok: false, error: "Project slug is not a valid host name." };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(buildId)) return { ok: false, error: "The saved app version is invalid." };
  return withSiteLock(sitesRoot(), slug, async function publish(signal) {
    return workerOperation("publication", "publication", () => withBuildCancellation(buildSignal(signal)!,
      () => publishSiteInternal(slug, buildId, distDir, bytes, options)));
  });
}
