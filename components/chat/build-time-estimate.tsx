"use client";

import { useEffect, useState } from "react";
import { durationRange, elapsedBuildMinutes, type BuildTiming } from "@/lib/build/duration";
import type { ProviderId } from "@/lib/agent/selection";

interface Props {
  buildId?: string;
  provider?: ProviderId;
  model?: string;
  queued?: boolean;
}

export function BuildTimeEstimate({ buildId, provider, model, queued = false }: Props): React.ReactElement {
  const query = new URLSearchParams();
  if (buildId) query.set("buildId", buildId);
  else if (provider) {
    query.set("provider", provider);
    if (model) query.set("model", model);
  }
  const url = `/api/build-estimate?${query}`;
  const [reading, setReading] = useState<{ url: string; data: BuildTiming; clockOffset: number } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [now, setNow] = useState<number | null>(null);

  useEffect(function loadTiming() {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read(): Promise<void> {
      if (!document.hidden) {
        try {
          const response = await fetch(url, { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error("Estimate unavailable");
          const data = await response.json() as BuildTiming;
          if (!controller.signal.aborted) {
            const receivedAt = Date.now();
            setReading({ url, data, clockOffset: Date.parse(data.serverNow) - receivedAt });
            setNow(receivedAt);
            setUnavailable(false);
          }
        } catch {
          if (!controller.signal.aborted) setUnavailable(true);
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(read, buildId ? 30_000 : 300_000);
    }
    void read();
    return function cleanup() { controller.abort(); clearTimeout(timer); };
  }, [url, buildId]);

  useEffect(function clock() {
    if (!buildId) return;
    const timer = setInterval(function tick() { setNow(Date.now()); }, 15_000);
    return function cleanup() { clearInterval(timer); };
  }, [buildId]);

  const current = reading?.url === url ? reading : null;
  const estimate = current?.data.estimate ?? null;
  const elapsed = current && now !== null && !queued ? elapsedBuildMinutes(current.data.startedAt, now + current.clockOffset) : null;
  let label = "Estimating build time";
  if (unavailable) label = "Time estimate unavailable";
  else if (current && !estimate) label = "Time estimate: more completed builds needed";
  else if (estimate) label = `Estimated build time: ${durationRange(estimate)}`;
  if (elapsed !== null) {
    const elapsedLabel = elapsed === 0 ? "Just started" : `${elapsed} min elapsed`;
    label = `${elapsedLabel} · ${label}`;
    if (!unavailable && estimate && elapsed >= estimate.upperMinutes) label = `${elapsedLabel} · Taking longer than the estimate`;
  }

  return <details className="group text-[11px] leading-5 text-ink-faint" data-build-timing>
    <summary className="cursor-pointer rounded py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood">{label}</summary>
    <p className="max-w-md pb-2 text-ink-soft">
      {estimate ? `Based on ${estimate.sampleSize} successful builds from this provider in the last 30 days, matched by model when recorded and by contract requirements after planning. ` : "An estimate appears after at least five matching successful builds. "}
      Queue waiting is separate. Scope, repairs and provider speed can change the time. The estimate does not change your build allowance.
    </p>
  </details>;
}
