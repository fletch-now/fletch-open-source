"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { ChevronRight } from "@/components/ui/icons";
import { activityGroups, mergeActivity, parseActivityEvent, type ActivityFilter, type ActivityGroup, type LiveRegistryEvent } from "@/lib/registry/live-activity";
import "./live-activity.css";
import { LiveValue } from "./live-reading";

interface Props { chainId: number }
type Connection = "connecting" | "live" | "reconnecting" | "polling" | "unavailable" | "paused" | "hidden";
const FILTERS: Array<{ value: ActivityFilter; label: string }> = [
  { value: "auto", label: "Auto" }, { value: "listing", label: "Listings" },
  { value: "alert", label: "Alerts" }, { value: "pool", label: "New pools" }, { value: "all", label: "All" },
];
const LABELS: Record<Connection, string> = { connecting: "Connecting", live: "Stream connected", reconnecting: "Reconnecting", polling: "Polling every 15s", unavailable: "Updates unavailable", paused: "Paused", hidden: "Tab inactive" };
const MOBILE_LABELS: Record<Connection, string> = { connecting: "Connecting", live: "Connected", reconnecting: "Reconnecting", polling: "Polling", unavailable: "Unavailable", paused: "Paused", hidden: "Inactive" };
const TONES = { alert: "border-amber-300 bg-amber-50/60", listing: "border-hood/30 bg-hood-wash/40", change: "border-line bg-paper", routine: "border-line bg-paper" };

function age(at: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(at)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function ActivityCard({ group, fresh, now }: { group: ActivityGroup; fresh: boolean; now: number }): ReactElement {
  const { event, members, importance } = group;
  const href = `/registry/changes?kind=${encodeURIComponent(event.kind)}${event.symbol ? `&symbol=${encodeURIComponent(event.symbol)}` : ""}`;
  let title = event.title;
  if (members.length > 1) title = `${members.length} new ${event.symbol ?? "token"} pools in 30 min`;
  return <article className={`min-w-0 rounded-xl border p-3 ${TONES[importance]} ${fresh ? "registry-activity-enter registry-activity-fresh" : ""}`}>
    <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-medium uppercase tracking-wider text-ink-soft">
      <span>{importance === "listing" ? "Robinhood app" : importance}</span>
      <time dateTime={event.observedAt} title={`Observed ${event.observedAt}`} className="shrink-0 normal-case tracking-normal">{age(event.observedAt, now)}</time>
    </div>
    <Link href={href} className="block min-h-11 break-words py-1 text-[13px] font-medium leading-5 text-ink hover:underline">{title}</Link>
    {importance === "listing" ? <p className="mt-2 text-[11px] text-ink-soft">Source: Robinhood currency-pair catalog.</p> : null}
    {members.length > 1 ? <details className="mt-2 text-xs text-ink-soft"><summary className="min-h-11 cursor-pointer py-3">Show {members.length} observations</summary>
      <ul className="mt-2 max-h-36 space-y-2 overflow-y-auto break-all">{members.map((member) => <li key={member.id}><time dateTime={member.observedAt}>{new Date(member.observedAt).toISOString().slice(11, 19)} UTC</time> · {String(member.detail.poolId ?? member.id)}</li>)}</ul>
    </details> : null}
  </article>;
}

export function LiveActivity({ chainId }: Props): ReactElement {
  const [events, setEvents] = useState<LiveRegistryEvent[]>([]);
  const [filter, setFilter] = useState<ActivityFilter>("auto");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [now, setNow] = useState(0);
  const [received, setReceived] = useState(0);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const cursor = useRef<string | null>(null);
  const kinds = useRef<string[]>([]);
  const [fresh, setFresh] = useState(new Map<string, number>());

  useEffect(function clock() {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(function follow() {
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let generation = 0;
    let lastHeartbeat = 0;
    const base = `/api/v1/chains/${chainId}/events`;

    function accept(rows: unknown[], animate: boolean): void {
      const parsed = rows.map(parseActivityEvent);
      if (parsed.some((event) => event === null)) throw new Error("Invalid activity response");
      const incoming = parsed as LiveRegistryEvent[];
      if (animate) {
        const at = Date.now();
        setFresh((previous) => {
          const next = new Map([...previous].filter(([, time]) => at - time < 8_000));
          for (const event of incoming) next.set(event.id, at);
          return next;
        });
        setReceived((count) => count + incoming.length);
      }
      setEvents((current) => mergeActivity(current, incoming));
      setNow(Date.now());
      setCheckedAt(new Date().toISOString());
    }

    function advance(next: unknown): void {
      if (typeof next === "string" && (!cursor.current || next > cursor.current)) cursor.current = next;
    }

    async function read(url: string, signal: AbortSignal): Promise<{ events: unknown[]; nextCursor: string; kinds?: string[] }> {
      const response = await fetch(url, { signal, cache: "no-store" });
      if (!response.ok) throw new Error(`Activity HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body.events) || typeof body.nextCursor !== "string") throw new Error("Invalid activity response");
      return body;
    }

    function stop(): void {
      generation++;
      source?.close();
      source = null;
      controller?.abort();
      clearTimeout(pollTimer);
    }

    async function start(): Promise<void> {
      stop();
      if (paused || document.hidden) {
        setConnection(paused ? "paused" : "hidden");
        return;
      }
      const current = generation;
      controller = new AbortController();
      const signal = controller.signal;
      setConnection("connecting");
      try {
        if (!cursor.current) {
          const [recent, listings] = await Promise.all([read(`${base}?limit=200`, signal), read(`${base}?kind=listing.&limit=20`, signal)]);
          if (generation !== current) return;
          accept([...recent.events, ...listings.events], false);
          kinds.current = (recent.kinds ?? []).filter((kind) => typeof kind === "string");
          if (!kinds.current.length) throw new Error("Activity kinds unavailable");
          advance(recent.nextCursor);
        }
        source = new EventSource(`${base}/stream?since=${encodeURIComponent(cursor.current!)}`);
        source.onopen = function connected() { lastHeartbeat = Date.now(); setConnection("live"); };
        source.onerror = function reconnecting() { setConnection("reconnecting"); };
        source.addEventListener("heartbeat", function heartbeat() { lastHeartbeat = Date.now(); setConnection("live"); setCheckedAt(new Date().toISOString()); });
        for (const kind of kinds.current) source.addEventListener(kind, function receive(raw) {
          try {
            const event = raw as MessageEvent;
            accept([JSON.parse(event.data)], true);
            advance(event.lastEventId);
            lastHeartbeat = Date.now();
          } catch { source?.close(); source = null; setConnection("unavailable"); }
        });
      } catch {
        if (signal.aborted) return;
        setConnection("unavailable");
      }
      async function poll(): Promise<void> {
        if (generation !== current) return;
        if (!cursor.current) { void start(); return; }
        let delay = 15_000;
        try {
          // The cursor also catches events missed while a tab was hidden or paused.
          if (!source || source.readyState !== EventSource.OPEN || Date.now() - lastHeartbeat > 30_000) {
            const body = await read(`${base}?cursor=${encodeURIComponent(cursor.current)}&limit=500`, signal);
            if (generation !== current) return;
            accept(body.events, true);
            advance(body.nextCursor);
            setConnection("polling");
            if (body.events.length === 500) delay = 1_000;
          }
        } catch { if (!signal.aborted) setConnection("unavailable"); }
        if (generation === current) pollTimer = setTimeout(() => { void poll(); }, delay);
      }
      if (generation === current) pollTimer = setTimeout(() => { void poll(); }, 15_000);
    }
    function visible(): void { void start(); }
    void start();
    document.addEventListener("visibilitychange", visible);
    return function cleanup() { stop(); document.removeEventListener("visibilitychange", visible); };
  }, [chainId, paused]);

  const groups = useMemo(() => activityGroups(events, filter, query), [events, filter, query]);
  const visible = groups.slice(0, expanded ? 12 : 3);
  return <section aria-label="Live registry activity" className="border-b border-line bg-panel/40 px-4 sm:px-6 lg:px-8">
    <div className="flex min-h-11 items-center gap-2">
      <button type="button" onClick={() => setBoardOpen((value) => !value)} aria-expanded={boardOpen} aria-controls="registry-activity-board"
        className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-sm pr-2 text-xs font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2">
        <ChevronRight className={`h-4 w-4 motion-safe:transition-transform ${boardOpen ? "-rotate-90" : "rotate-90"}`} />
        {boardOpen ? "Hide live updates" : "Show live updates"}
        {received ? <span className="hidden font-normal text-ink-soft sm:inline">({received.toLocaleString("en-US")})</span> : null}
      </button>
      <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[11px] text-ink-soft sm:ml-1" title={LABELS[connection]}>
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${connection === "live" ? "registry-activity-dot bg-hood" : "bg-amber-500"}`} />
        <span className="sm:hidden" aria-hidden>{MOBILE_LABELS[connection]}</span><span className="sr-only sm:not-sr-only">{LABELS[connection]}</span>
      </span>
      <span className="ml-2 hidden min-w-0 truncate text-[11px] text-ink-soft lg:block"><LiveValue value={groups[0]?.event.title ?? "Waiting for observed changes"} /></span>
    </div>
    <div id="registry-activity-board" hidden={!boardOpen} className={`pb-3 ${boardOpen ? "registry-activity-enter" : ""}`}>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-1 text-xs">
      <p className="text-ink-soft">{received.toLocaleString("en-US")} new observations during this visit</p>
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => setPaused((value) => !value)} aria-pressed={paused} className="min-h-11 rounded-md px-2 text-ink hover:bg-paper focus-visible:outline-2">{paused ? "Resume updates" : "Pause updates"}</button>
        <Link href="/registry/changes" className="inline-flex min-h-11 items-center text-ink-soft underline underline-offset-4">Full changelog</Link>
      </div>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Activity importance" className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-line bg-paper p-1">
        {FILTERS.map((option) => <button type="button" key={option.value} aria-pressed={filter === option.value} onClick={() => setFilter(option.value)} className={`min-h-11 shrink-0 rounded-md px-3 text-xs transition-colors ${filter === option.value ? "bg-ink text-paper" : "text-ink-soft hover:bg-panel"}`}>{option.label}</button>)}
      </div>
      <input aria-label="Filter activity by ticker or text" placeholder="Filter ticker or text" value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 w-full max-w-full sm:w-44 rounded-lg border border-line bg-paper px-3 text-xs text-ink outline-offset-2" />
      <p className="text-[11px] text-ink-soft">{filter === "auto" ? "Auto: alerts, catalog changes, then other updates. Pool bursts stay in New pools." : "Newest observations first. Same-token pool bursts are grouped."}</p>
    </div>
    <p className="sr-only" role="status" aria-live="polite">{paused ? "Activity updates paused" : `${received} observations received during this visit`}</p>
    {visible.length ? <div className="mt-3 grid gap-2 md:grid-cols-3">{visible.map((group) => <ActivityCard key={group.event.id} group={group} fresh={now - (fresh.get(group.event.id) ?? 0) < 8_000} now={now} />)}</div> : <p className="mt-3 rounded-xl border border-dashed border-line p-4 text-xs text-ink-soft">{events.length ? "No observations match this filter in the board’s recent window." : "Waiting for recorded observations."}</p>}
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-ink-soft">
      <span>{checkedAt ? `Connection checked ${age(checkedAt, now)}.` : "Connecting to Fletch’s recorded events."} <Link className="inline-flex min-h-11 items-center underline" href="/registry/status">Source freshness</Link></span>
      {groups.length > 3 ? <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} className="min-h-11 px-2 text-xs hover:text-ink">{expanded ? "Show less" : `Show more (${groups.length})`}</button> : null}
    </div>
    </div>
  </section>;
}
