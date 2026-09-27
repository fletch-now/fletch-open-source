export interface PublicationStatus {
  draft: { buildId: string; previewUrl: string; createdAt: string; bytes: number } | null;
  live: { buildId: string | null; url: string } | null;
  job: { buildId: string; state: "queued" | "publishing" | "published" | "failed"; error: string | null } | null;
}
