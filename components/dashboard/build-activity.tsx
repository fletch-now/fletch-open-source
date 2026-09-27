"use client";

import { useEffect, useState } from "react";
import Link from "@/components/ui/navigation-link";
import { useHydratedSession } from "@/lib/auth/use-hydrated-session";
import type { ActiveBuild } from "@/app/api/builds/active/route";
import { useFloatingPosition } from "./use-floating-position";
import styles from "./build-activity.module.css";

const POLL_MS = 5_000;

function elapsedText(since: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  if (!Number.isFinite(seconds)) return "";
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

function statusText(build: ActiveBuild): string {
  if (build.status === "paused") return "Paused. Open build to review.";
  if (build.status === "queued") return build.ahead > 0 ? `In queue. ${build.ahead} ahead.` : "Next in queue";
  if (build.status === "compiling") return "Checking the code";
  if (build.status === "provisioning") return "Preparing the workspace";
  return "Building your app";
}

// One poller survives page navigation. Account changes clear private details and
// abort requests, rather than retaining another account's in-flight response.
export function BuildActivity(): React.ReactNode {
  const session = useHydratedSession();
  return session?.user.id ? <AccountBuildActivity key={session.user.id} /> : null;
}

function AccountBuildActivity(): React.ReactNode {
  const [active, setActive] = useState<ActiveBuild[]>([]);
  const [checkedAt, setCheckedAt] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(function poll() {
    let live = true;
    let pending = false;
    let request: AbortController | undefined;
    async function read(): Promise<void> {
      if (document.hidden || pending) return;
      pending = true;
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 10_000);
      try {
        const response = await fetch("/api/builds/active", { cache: "no-store", signal: request.signal });
        if (response.status === 401) { if (live) setActive([]); return; }
        if (!response.ok) throw Error("Build status unavailable");
        const body = await response.json() as { builds: ActiveBuild[] };
        if (!Array.isArray(body.builds)) throw Error("Build status unavailable");
        if (live) {
          setActive(body.builds);
          setCheckedAt(Date.now());
          setNow(Date.now());
          setUnavailable(false);
        }
      } catch {
        if (live) setUnavailable(true);
      } finally {
        clearTimeout(timeout);
        pending = false;
      }
    }
    void read();
    const timer = setInterval(read, POLL_MS);
    document.addEventListener("visibilitychange", read);
    window.addEventListener("online", read);
    return function stop() {
      live = false;
      request?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
      window.removeEventListener("online", read);
    };
  }, []);

  useEffect(function clock() {
    if (!active.length) return;
    const timer = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1_000);
    return () => clearInterval(timer);
  }, [active.length]);

  return active.length ? <BuildActivityCard builds={active} now={now} stale={unavailable || now - checkedAt > 15_000} /> : null;
}

function BuildActivityCard({ builds, now, stale }: { builds: ActiveBuild[]; now: number; stale: boolean }): React.ReactNode {
  const { cardRef, handleProps, reset } = useFloatingPosition();
  return (
    <aside ref={cardRef} className={styles.card} aria-label="Your active builds" data-active-build-card>
      <div className={styles.header}>
        <button type="button" className={styles.handle} {...handleProps} aria-label="Move active build card" title="Drag to move. Arrow keys move the card; Home resets its position.">
          <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="1.3" /><circle cx="10" cy="4" r="1.3" /><circle cx="4" cy="9" r="1.3" /><circle cx="10" cy="9" r="1.3" /><circle cx="4" cy="14" r="1.3" /><circle cx="10" cy="14" r="1.3" /></svg>
          <span>{builds.length === 1 ? "Your build" : `Your builds (${builds.length})`}</span>
          <span className={styles.move}>Drag to move</span>
        </button>
        <button type="button" onClick={reset} className={styles.reset} aria-label="Reset build card position" title="Reset position">↺</button>
      </div>
      <div className={styles.builds}>
        {builds.map(build => (
          <Link key={build.id} href={build.projectId ? `/dashboard/build?project=${build.projectId}` : "/dashboard/build"} className={styles.build}>
            <div className={styles.title}>
              <span className={`${styles.dot} ${build.status === "paused" || stale ? styles.still : ""}`} aria-hidden="true" />
              <span className={styles.name}>{build.projectName || "New app"}</span>
              <span className={styles.elapsed} title="Time since the build started">{elapsedText(build.since, now)}</span>
            </div>
            <p className={styles.status}>{stale ? "Last known status: " : ""}{statusText(build)}</p>
            <span className={styles.open}>Open build <span aria-hidden="true">↗</span></span>
          </Link>
        ))}
      </div>
      {stale ? <p className={styles.connection} role="status">Status connection interrupted. Retrying…</p> : null}
    </aside>
  );
}
