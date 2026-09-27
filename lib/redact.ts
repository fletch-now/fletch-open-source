// Provider libraries include their complete URL in errors. Redact before
// truncating or persisting, since a truncated credential is still a leak.
export function redactSecrets(text: string): string {
  let clean = text;
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= 8 && /(?:API_KEY|BOT_TOKEN|TOKEN_KEY|SECRET|RPC_(?:LOG_)?URL_\d+)$/.test(name)) {
      clean = clean.replaceAll(value, "[redacted]");
    }
  }
  return clean
    .replace(/(https?:\/\/[^\s/]+\/v2\/)[^\s?"<>]+/g, "$1[redacted]")
    .replace(/(api\.telegram\.org\/bot)\d+:[A-Za-z0-9_-]+/g, "$1[redacted]");
}
