"use client";

import { MarkdownText } from "@/components/chat/markdown-text";
import type { BuildMaintenanceSnapshot } from "@/lib/build/maintenance";
import type { BuildQueueState } from "@/lib/build/queue-types";
import { describeBuildQueue } from "@/lib/build/queue-status";
import type { ToolCall } from "@/lib/chat/types";
import { briefReply } from "@/lib/chat/brief-reply";
import { BuildTimeEstimate } from "@/components/chat/build-time-estimate";
import { publicDiagnostic } from "@/lib/public-copy";

interface BuildReplyProps {
  content: string;
  buildId?: string;
  active?: boolean;
  toolCalls?: ToolCall[];
  status?: string | null;
  reconnecting?: boolean;
  paused?: boolean;
  maintenance?: BuildMaintenanceSnapshot | null;
  queue?: BuildQueueState | null;
  queueBusy?: boolean;
  onCancelQueue?: () => void;
  onEditQueuedPrompt?: () => void;
}

export function BuildReply({
  content,
  buildId,
  active = false,
  toolCalls = [],
  status = null,
  reconnecting = false,
  paused = false,
  maintenance = null,
  queue = null,
  queueBusy = false,
  onCancelQueue,
  onEditQueuedPrompt,
}: BuildReplyProps): React.ReactElement {
  const visibleContent = publicDiagnostic(content);
  const { brief, folded } = briefReply(visibleContent);
  const queueMessage = queue ? describeBuildQueue(queue) : null;
  const showDetails = (folded && content.trim().length > 0) || toolCalls.length > 0 || (!queue && Boolean(buildId || active));
  let activity = reconnecting ? "reconnecting" : "working";
  if (paused) activity = "paused";
  return (
    <div className="w-full min-w-0 space-y-3">
      <p role={active ? "status" : undefined} className="flex items-center gap-2 text-xs font-medium text-ink-faint">
        {active && !queue && !paused ? <span aria-hidden="true" data-build-loader className="h-3 w-3 shrink-0 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" /> : null}
        Fletch{active && !queue ? ` · ${activity}` : ""}
      </p>
      {active && buildId && !paused ? <BuildTimeEstimate buildId={buildId} queued={Boolean(queue)} /> : null}
      {active && maintenance && !queue && !paused ? <p role="status" className="rounded-xl border border-line bg-panel/40 p-4 text-xs leading-5 text-ink-soft" data-build-maintenance>{reconnecting ? "Reconnecting. The last recorded update said the builder was being updated; recorded progress is kept below." : "Builder is being updated. Your current build continues."}</p> : null}
      {active && paused ? <p role="status" className="text-xs text-ink-soft">{status ? publicDiagnostic(status) : null}</p> : null}
      {active && queue && queueMessage ? (
        <div className="space-y-4 rounded-xl border border-line bg-panel/40 p-4 text-xs text-ink-soft" data-build-queue>
          <div role="status" aria-live="polite" aria-atomic="true" className="space-y-1.5">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="8.5" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" /></svg>
              {reconnecting ? "Reconnecting" : queueMessage.title}
            </p>
            <p className="leading-5">{reconnecting ? "Confirming your queue status. The last recorded position is shown below." : queueMessage.description}</p>
          </div>
          {reconnecting && queue.maintenance ? <p className="leading-5">Last recorded status: builder update. Your queued build is saved.</p> : null}
          <dl className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <dt className="text-ink-faint">Your place</dt>
              <dd className="inline-flex min-h-7 items-center rounded-full bg-hood/10 px-2.5 font-medium text-ink">
                {queue.ahead === 0 ? "Next in line" : `#${queue.position} in queue`}
              </dd>
            </div>
            <div className="space-y-1.5">
              <dt className="text-ink-faint">Build capacity</dt>
              <dd className="inline-flex min-h-7 items-center rounded-full bg-panel px-2.5 tabular-nums">{`${queue.running} of ${queue.capacity} building`}</dd>
            </div>
          </dl>
          {queue.reserved > 0 ? <p className="flex items-center gap-2 leading-5"><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint" />{queue.reserved} {queue.reserved === 1 ? "slot held" : "slots held"} for recovery</p> : null}
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <button type="button" disabled={queueBusy} onClick={onCancelQueue} className="min-h-9 rounded-lg border border-line px-3 hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood disabled:opacity-50">Cancel queue</button>
            <button type="button" disabled={queueBusy} onClick={onEditQueuedPrompt} className="min-h-9 rounded-lg border border-line px-3 hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood disabled:opacity-50">Edit prompt</button>
          </div>
          <p role={queueBusy ? "status" : undefined} className="flex items-start gap-2 text-ink-faint leading-5">
            {queueBusy ? <span aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" /> : null}
            {queueBusy ? "Confirming your change to the queue." : "Editing returns your prompt to the composer. Sending it again joins the end of the queue."}
          </p>
        </div>
      ) : null}
      {content.trim() ? <MarkdownText content={brief} /> : null}
      {showDetails ? (
        <details key={active ? "running" : "finished"} open={active} className="group min-w-0">
          <summary className="w-fit cursor-pointer rounded-md py-1 text-xs text-ink-faint transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood">
            Build details · <span className="tabular-nums">{toolCalls.length}</span> {toolCalls.length === 1 ? "step" : "steps"}
          </summary>
          <div className="mt-3 min-w-0 space-y-3 border-l border-line pl-3">
            {folded && content.trim() ? <MarkdownText content={visibleContent} /> : null}
            {active && !queue && !paused ? <p className="text-xs text-ink-soft">{reconnecting ? "Reconnecting to the build. Recorded steps are kept below." : "Connected to the build. Waiting for the next recorded update."}</p> : null}
            {active && !queue && !paused && status ? <p className="text-xs text-ink-soft">Last recorded update: {publicDiagnostic(status)}</p> : null}
            {toolCalls.length > 0 ? (
              <ol
                className="min-w-0 space-y-4"
                aria-label="Recorded build steps"
              >
                {toolCalls.map(function step(call, index) {
                  return (
                    <li
                      key={index}
                      className="min-w-0 space-y-1 text-xs leading-5 [overflow-wrap:anywhere]"
                    >
                      <span className="text-ink-faint">
                        <span className="font-mono">{index + 1}.</span> {call.tool}
                      </span>
                      <p className="whitespace-pre-wrap break-words text-ink-soft">
                        {publicDiagnostic(call.input)}
                      </p>
                      {call.summary ? (
                        <p className="whitespace-pre-wrap break-words text-ink-soft">
                          {publicDiagnostic(call.summary)}
                        </p>
                      ) : null}
                      {call.output !== undefined ? (
                        <div className="min-w-0 space-y-1">
                          <p className="text-ink-faint">
                            Tool output{call.outputTruncated ? ` · Showing ${call.output.length} of ${call.outputChars ?? "unknown total"} characters` : ""}
                          </p>
                          <pre tabIndex={0} aria-label={`Recorded output for step ${index + 1}`} className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-panel p-2 font-mono text-[11px] leading-5 text-ink-soft focus-visible:outline-2 focus-visible:outline-hood">{publicDiagnostic(call.output)}</pre>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : null}
            {active && !queue && !paused ? <div role="status" aria-live="polite" className="sticky bottom-0 flex items-center gap-2 rounded-lg border border-line bg-paper/95 px-3 py-2 text-xs text-ink-soft" data-build-step-activity>
              <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" />
              <span>{reconnecting ? "Reconnecting to progress. Your recorded steps are saved." : "Your prompt is being built. New steps appear here as they finish."}</span>
            </div> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
