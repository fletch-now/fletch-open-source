
// Structured operational logging. One JSON line per event on stdout, which
// journald already captures, so production issues can be inspected with
//   journalctl -u fletch | grep '"scope":"build"'
// without attaching a debugger to a live server.

import { redactSecrets } from "@/lib/redact";

export function logEvent(scope: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), scope, ...data }, function redact(_key, value) {
    return typeof value === "string" ? redactSecrets(value) : value;
  }));
}
