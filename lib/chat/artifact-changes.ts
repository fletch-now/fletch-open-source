import type { BuildArtifact } from "@/lib/build/types";

export type ArtifactChange = "new" | "changed" | "updated";

export function artifactChanges(
  previous: BuildArtifact[],
  latest: BuildArtifact[],
  current: BuildArtifact[],
  previousComplete = false,
): Record<string, ArtifactChange> {
  const before = new Map(
    previous.map(function entry(file) {
      return [file.path, file];
    }),
  );
  const after = new Map(
    latest.map(function entry(file) {
      return [file.path, file];
    }),
  );
  const changes: Record<string, ArtifactChange> = {};
  for (const file of current) {
    const written = after.get(file.path);
    if (!written) continue;
    // A saved event cannot describe a file modified again outside that build.
    if (
      written.contentHash &&
      file.contentHash &&
      written.contentHash !== file.contentHash
    )
      continue;
    const original = before.get(file.path);
    if (!original && previousComplete) changes[file.path] = "new";
    else if (original?.contentHash && written.contentHash) {
      if (original.contentHash !== written.contentHash)
        changes[file.path] = "changed";
    } else changes[file.path] = "updated";
  }
  return changes;
}
