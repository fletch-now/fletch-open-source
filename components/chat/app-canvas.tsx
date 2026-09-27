"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, RotateCcw } from "@/components/ui/icons";
import { ControlPopover } from "@/components/chat/control-popover";
import {
  previewViewport,
  fitPreview,
  type PreviewDevice,
} from "@/components/chat/preview-viewport";
import type { Stage } from "@/components/chat/pipeline";
import type { PublicationStatus } from "@/lib/hosting/publication-types";
import type { BuildResult } from "@/components/chat/artifact-panel";

const STAGE_TEXT: Record<Stage, string> = {
  idle: "Waiting to start",
  planning: "Deciding what the app needs",
  writing: "Writing the code",
  compiling: "Compiling the contract",
  testing: "Running the tests and the security scan",
  deploying: "Deploying to testnet",
  hosting: "Preparing the app preview",
  done: "Finishing",
};

interface AppCanvasProps {
  publication?: PublicationStatus | null;
  result: BuildResult | null;
  running: boolean;
  stage: Stage;
  status: string | null;
  hasThread: boolean;
}

export function AppCanvas({
  publication,
  result,
  running,
  stage,
  status,
  hasThread,
}: AppCanvasProps): React.ReactElement {
  const [device, setDevice] = useState<PreviewDevice>("responsive");
  const [zoom, setZoom] = useState("fit");
  const [refresh, setRefresh] = useState(0);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const viewport = previewViewport(available.width, available.height, device);
  const scale =
    zoom === "fit"
      ? fitPreview(available.width, available.height, device)
      : Number(zoom);
  const draft = publication?.draft && publication.draft.buildId !== publication.live?.buildId ? publication.draft : null;
  const liveUrl = publication?.live?.url ?? result?.previewUrl ?? null;
  const url = draft?.previewUrl ?? liveUrl;

  useEffect(function observeViewport() {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(function measure(entries) {
      const { width, height } = entries[0].contentRect;
      setAvailable({ width, height });
    });
    observer.observe(container);
    return function stop() {
      observer.disconnect();
    };
  }, []);

  let badge = "No saved preview";
  if (draft) badge = "Draft preview";
  else if (url) badge = "Published";
  if (running) badge = url ? "Building. Showing the last saved version" : "Building";

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel/40">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-raised px-3 py-2" aria-label="Preview toolbar">
        {draft ? <span className="min-w-0 flex-1 text-[12px] leading-4 text-ink-soft">Draft preview. Publish to connect a wallet.</span> : null}
        {!draft && url ? <a href={url} target="_blank" rel="noreferrer" title={`${badge}: ${url}`}
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-soft underline-offset-2 hover:underline">{url}</a> : null}
        {!url ? <span className="min-w-0 flex-1 truncate text-[12px] text-ink-soft">Your app preview</span> : null}
        <button type="button" disabled={!url} onClick={function reload() { setRefresh(function increment(value) { return value + 1; }); }}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[12px] text-ink-soft hover:bg-panel focus-visible:outline-2 focus-visible:outline-hood disabled:opacity-40" aria-label="Refresh preview">
          <RotateCcw className="h-3.5 w-3.5" /><span className="hidden sm:inline">Refresh</span>
        </button>
        {liveUrl ? <a href={liveUrl} target="_blank" rel="noreferrer"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-hood-deep hover:bg-hood-wash focus-visible:outline-2 focus-visible:outline-hood">
          Open live app <ExternalLink className="h-3 w-3" />
        </a> : null}
        <ControlPopover label="Preview settings" align="end" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-panel" panelClassName="w-64"
          trigger={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m9 3 1-1h4l1 1 .5 2 2 1 2-.5 2 3-.5 2-1.5 1v2l1.5 1 .5 2-2 3-2-.5-2 1-.5 2-1 1h-4l-1-1-.5-2-2-1-2 .5-2-3 .5-2L4 14v-2l-1.5-1L2 9l2-3 2 .5 2-1L9 3Z"/><circle cx="12" cy="12" r="3"/></svg>}>
          {function settings(close) {
            const devices: Array<{ value: PreviewDevice; label: string }> = [
              { value: "responsive", label: "Responsive" }, { value: "desktop", label: "Desktop · 1440 × 900" },
              { value: "tablet", label: "Tablet · 768 × 1024" }, { value: "phone", label: "Phone · 390 × 844" },
            ];
            return <>
              <p className="px-3 py-2 text-[11px] font-medium text-ink-faint">Device</p>
              {devices.map(function option(item) {
                return <button key={item.value} type="button" data-popover-item tabIndex={-1} role="menuitemradio" aria-checked={device === item.value}
                  onClick={function select() { setDevice(item.value); setZoom("fit"); close(); }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[12px] hover:bg-panel focus-visible:bg-panel focus-visible:outline-none">
                  {item.label}<span aria-hidden="true">{device === item.value ? "✓" : ""}</span>
                </button>;
              })}
              <p className="mt-1 border-t border-line px-3 py-2 text-[11px] font-medium text-ink-faint">Zoom</p>
              {[{ value: "fit", label: "Fit to pane" }, { value: "0.5", label: "50%" }, { value: "0.75", label: "75%" }, { value: "1", label: "100%" }].map(function option(item) {
                return <button key={item.value} type="button" data-popover-item tabIndex={-1} role="menuitemradio" aria-checked={zoom === item.value}
                  onClick={function select() { setZoom(item.value); close(); }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[12px] hover:bg-panel focus-visible:bg-panel focus-visible:outline-none">
                  {item.label}<span aria-hidden="true">{zoom === item.value ? "✓" : ""}</span>
                </button>;
              })}
            </>;
          }}
        </ControlPopover>
      </div>
      <div className="min-h-0 flex-1 p-3">
        <div ref={containerRef} className="h-full min-h-0 overflow-auto">
          {url ? (
            <div
              className="relative mx-auto overflow-hidden rounded-lg bg-white"
              data-preview-frame
              style={{
                width: viewport.width * scale,
                height: viewport.height * scale,
              }}
            >
              <iframe
                key={`${url}:${refresh}`}
                src={url}
                title="Your app"
                width={viewport.width}
                height={viewport.height}
                className="absolute left-0 top-0 max-w-none border-0"
                style={{
                  width: viewport.width,
                  height: viewport.height,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                }}
                sandbox={draft ? "allow-scripts" : "allow-scripts allow-same-origin allow-forms allow-popups"}
                referrerPolicy="no-referrer"
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-4">
              <div className="max-w-[38ch] text-center">
                <p className="text-[15px] font-medium text-ink">
                  {running ? STAGE_TEXT[stage] : "Your app preview"}
                </p>
                <p className="mt-2 text-[13px] leading-6 text-ink-soft">
                  {running
                    ? status
                    : "Your saved preview appears here when the build finishes. Publish it when you are ready."}
                </p>
                {hasThread && !running ? (
                  <p className="mt-2 text-[12px] leading-5 text-ink-faint">
                    No ready preview is recorded for this project. Review
                    the build details in Chat.
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
