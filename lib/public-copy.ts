// Apply to displayed diagnostics, not structured URLs or executable artifacts.
export function publicDiagnostic(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"']*blockscout[^\s<>"']*/gi, "[explorer endpoint]")
    .replace(/\bblockscout\b/gi, "chain explorer");
}
