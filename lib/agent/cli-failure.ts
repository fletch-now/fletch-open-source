// The CLI's stderr is written for whoever runs it in a terminal: it points at log
// files inside the container and leaks internal paths. None of that helps a user,
// and the container is gone by the time they read it.
export function friendlyAgentFailure(raw: string | null, code: number | null, stderr: string): string {
  const text = (raw ?? "").trim();
  // 143 is SIGTERM: the server (or a deploy restarting it) killed the agent, not
  // the agent failing on its own. Say so, plainly.
  if (code === 143) {
    return "The build was interrupted by a server restart. Provider usage may still be billed; run it again.";
  }
  if (stderr.includes("provider.api_error: 400 The model exceeded the response time limit.")) {
    return "The model exceeded the response time limit and was stopped. Provider usage may still be billed; try a smaller task or retry explicitly.";
  }
  // The CLI appends a session/log hint after its provider exception. Read the
  // bounded stderr for that exact proxy message, not its trailing hint or 400.
  const providerStatus = stderr.match(/provider\.api_error: (?:400|502) The model provider returned ([1-5]\d{2})\./)?.[1];
  if (providerStatus === "429") {
    return "The model provider rejected the request (HTTP 429). Your source files are saved. Try again later or choose another model connection.";
  }
  if (providerStatus === "401" || providerStatus === "403") {
    return `The model provider rejected access (HTTP ${providerStatus}). Your source files are saved. Check the selected provider connection.`;
  }
  if (providerStatus === "402") {
    return "The model provider rejected the request (HTTP 402). Your source files are saved. Check your provider billing before retrying.";
  }
  if (providerStatus) {
    return `The model provider returned HTTP ${providerStatus}. Your source files are saved. Provider usage may still be billed.`;
  }
  if (/401|unauthor|invalid[_ -]?api[_ -]?key|authentication/i.test(text)) {
    return "The build service rejected our credentials. Provider usage may still be billed.";
  }
  if (/402|insufficient|balance|quota|billing/i.test(text)) {
    return "The build service is out of capacity right now. Provider usage may still be billed.";
  }
  if (/429|rate.?limit|too many requests/i.test(text)) {
    return "The build service is busy. Try again in a moment.";
  }
  // Anything referencing the sandbox filesystem, or a long dump, is internal.
  if (!text || /\/work\/|\.kimi-code|See log:|node_modules/i.test(text) || text.length > 160) {
    return `The build agent stopped before finishing${code === null ? "" : ` (exit ${code})`}. Provider usage may still be billed.`;
  }
  return text;
}
