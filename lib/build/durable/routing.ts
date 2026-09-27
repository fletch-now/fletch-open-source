export function workerBuildsEnabled(value = process.env.FORGE_BUILD_EXECUTION): boolean {
  if (value === undefined || value === "legacy") return false;
  if (value === "worker") return true;
  throw new Error("FORGE_BUILD_EXECUTION must be legacy or worker.");
}
