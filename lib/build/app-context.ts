export interface AppContext {
  kind: "new" | "follow-up" | "missing-source";
  files: string[];
}

function isAppSource(path: string): boolean {
  if (/^(brief|test|tests|fletch|node_modules|out|dist|cache)\//.test(path)) return false;
  if (/\.(?:config\.[cm]?[jt]s|t\.sol)$/.test(path)) return false;
  return /\.sol$/.test(path) || /\.(?:[cm]?[jt]sx?|html|css)$/.test(path);
}

// A saved brief, session or config is evidence of an attempt, not an app.
export function appContext(paths: string[], previouslyDelivered = false): AppContext {
  const files = paths.filter(isAppSource);
  if (files.length > 0) return { kind: "follow-up", files };
  return { kind: previouslyDelivered ? "missing-source" : "new", files };
}
