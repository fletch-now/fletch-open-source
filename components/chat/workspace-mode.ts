export type WorkspaceMode = "preview" | "code" | "chat";

export function modeKey(projectId?: string): string {
  return `fletch.build.mode.${projectId ?? "new"}`;
}

export function readMode(
  storage: Pick<Storage, "getItem">,
  projectId?: string,
): WorkspaceMode | null {
  try {
    const value = storage.getItem(modeKey(projectId));
    if (value === "preview" || value === "code" || value === "chat")
      return value;
  } catch {
    // Storage can be blocked even when the browser exposes the API.
  }
  return null;
}

export function saveMode(
  storage: Pick<Storage, "setItem">,
  mode: WorkspaceMode,
  projectId?: string,
): void {
  try {
    storage.setItem(modeKey(projectId), mode);
  } catch {
    /* The current choice remains usable. */
  }
}
