"use client";

import { CircleAlert } from "@/components/ui/icons";
import type { BuildResult } from "@/components/chat/artifact-panel";

interface ActionCardProps {
  result: BuildResult | null;
  projectId?: string;
  running: boolean;
  // Sends a prompt into the console, for the cases that need the agent.
  onPrompt: (prompt: string) => void;
}

// What the last build could not finish, and the one thing that fixes it.
// The text is the build's own note; the buttons only exist for steps Fletch
// can actually retry.
export function ActionCard({ result, running, onPrompt }: ActionCardProps): React.ReactElement | null {
  const notes = result?.notes ?? [];
  if (running || notes.length === 0 || result?.previewUrl || result?.draftReady) {
    return null;
  }
  const publishFailed = notes.some(function isPublish(note) {
    return /not serving yet|did not answer yet/i.test(note);
  });
  const notDeployed = notes.some(function isDeploy(note) {
    return /^Not deployed/i.test(note);
  });

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-amber-900">Needs attention before it is live</p>
          <ul className="mt-1 space-y-1">
            {notes.map(function renderNote(note) {
              return (
                <li key={note} className="text-[12.5px] leading-5 text-amber-800">
                  {note}
                </li>
              );
            })}
          </ul>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {publishFailed ? <p className="text-[12.5px] leading-5 text-amber-800">
              Use Publish live app above for a saved preview. If this older build has no preview, ask the builder to prepare one.
            </p> : null}
            {notDeployed ? (
              <button
                type="button"
                onClick={function again() {
                  onPrompt("Deploy the app contract and prepare the app preview. Change nothing else in the code.");
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-amber-300 px-3.5 text-[12.5px] font-medium text-amber-900 transition-colors hover:bg-amber-100"
              >
                Deploy again
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
