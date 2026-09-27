"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, PenLine } from "@/components/ui/icons";
import { ControlPopover, PopoverChevron, POPOVER_ITEM_CLASS } from "@/components/chat/control-popover";
import type { WorkspaceProject } from "@/components/chat/build-workspace";

interface AppPickerProps {
  projects: WorkspaceProject[];
  projectId?: string;
}

const MAX_NAME = 60;

export function AppPicker({
  projects,
  projectId,
}: AppPickerProps): React.ReactElement {
  const router = useRouter();
  const [names, setNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    function focusOnEdit() {
      if (editing) {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    },
    [editing],
  );

  function nameOf(project: WorkspaceProject): string {
    return names[project.id] ?? project.name;
  }

  function open(id: string | null): void {
    router.push(id ? `/dashboard/build?project=${id}` : "/dashboard/build");
  }

  function startRename(project: WorkspaceProject): void {
    setEditing(project.id);
    setDraft(nameOf(project));
  }

  async function save(id: string): Promise<void> {
    const name = draft.trim().replace(/\s+/g, " ");
    if (name.length === 0 || name.length > MAX_NAME) {
      toast.error(`A name is 1 to ${MAX_NAME} characters.`);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json().catch(function notJson() {
        return {};
      })) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "The name did not save.");
      }
      setNames(function keep(current) {
        return { ...current, [id]: name };
      });
      setEditing(null);
      // The sidebar, the projects list and this page's own title read the name
      // from the server, so they refresh rather than drift from what is stored.
      router.refresh();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "The name did not save.",
      );
    } finally {
      setSaving(false);
    }
  }

  const current = projects.find(function selected(project) {
    return project.id === projectId;
  });

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-2"
    >
      {editing && current ? (
        <form
          onSubmit={function submit(event) {
            event.preventDefault();
            void save(current.id);
          }}
          className="flex min-w-0 flex-1 items-center gap-1"
        >
          <input
            ref={inputRef}
            value={draft}
            maxLength={MAX_NAME}
            disabled={saving}
            onChange={function type(event) {
              setDraft(event.target.value);
            }}
            onKeyDown={function keys(event) {
              if (event.key === "Escape") setEditing(null);
            }}
            aria-label="App name"
            className="h-8 min-w-0 flex-1 rounded-lg border border-hood bg-raised px-2 text-[12px] text-ink"
          />
          <button
            type="submit"
            disabled={saving}
            aria-label="Save the name"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-hood text-black disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={function cancel() {
              setEditing(null);
            }}
            className="h-8 shrink-0 px-1 text-[11px] text-ink-soft"
          >
            Cancel
          </button>
        </form>
      ) : (
        <>
          <ControlPopover label="Current project" className="flex-1 justify-between" title={current ? nameOf(current) : "Choose a project"}
            trigger={<><span className="truncate">{current ? nameOf(current) : "Choose a project"}</span><PopoverChevron /></>}>
            {function projectMenu(close) {
              return <>
                {projects.length === 0 ? <p className="px-2.5 py-2 text-xs text-ink-faint">Your saved apps will appear here.</p> : null}
                {projects.map(function projectRow(project) {
                  return <button key={project.id} type="button" role="menuitemradio" aria-checked={current?.id === project.id} data-popover-item tabIndex={-1}
                    className={POPOVER_ITEM_CLASS} onClick={function choose() { close(); open(project.id); }}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{nameOf(project)}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
                        <span>{project.buildCount} {project.buildCount === 1 ? "build" : "builds"}</span>
                        {project.previewUrl ? <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-hood" />Live</span> : null}
                      </span>
                    </span>
                    {current?.id === project.id ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : null}
                  </button>;
                })}
              </>;
            }}
          </ControlPopover>
          {current ? (
            <button
              type="button"
              onClick={function rename() {
                startRename(current);
              }}
              aria-label={`Rename ${nameOf(current)}`}
              title="Rename app"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-panel"
            >
              <PenLine className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </>
      )}
      <button type="button" onClick={function create() { open(null); }}
        className="h-11 sm:h-9 shrink-0 rounded-lg bg-hood px-2.5 text-xs font-medium text-black hover:bg-hood/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood">
        New app
      </button>
    </div>
  );
}
