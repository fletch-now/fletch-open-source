export function generatedProjectName(text: string | null): string | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || !("name" in value) || typeof value.name !== "string") return null;
    const name = value.name.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 60 || /[<>\u0000-\u001f\u007f]/.test(name) || /^#+\s/.test(name)) return null;
    return name;
  } catch { return null; }
}
