import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { workspaceRoot } from "@/lib/build/workspace";
import { readWorkspaceFile } from "@/lib/build/workspace-files";

import { generatedProjectName } from "@/lib/build/project-name-rules";

export async function applyGeneratedProjectName(projectId: string): Promise<void> {
  const [project] = await db.select({ slug: projects.slug }).from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.nameSource, "placeholder"))).limit(1);
  if (!project) return;
  const text = await readWorkspaceFile(join(workspaceRoot(), project.slug), "fletch.project.json", 16_384);
  const name = generatedProjectName(text);
  if (!name) return;
  // The user can rename while the agent works. That newer choice wins atomically.
  await db.update(projects).set({ name, nameSource: "agent" })
    .where(and(eq(projects.id, projectId), eq(projects.nameSource, "placeholder")));
}
