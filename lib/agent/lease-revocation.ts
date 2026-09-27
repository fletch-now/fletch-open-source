type RevocationListener = (credentialId: string) => void;

// Route and instrumentation bundles share one process-local revocation bus.
const state = globalThis as typeof globalThis & { __fletchCredentialRevocations?: Set<RevocationListener> };
const listeners = state.__fletchCredentialRevocations ??= new Set<RevocationListener>();

export function onCredentialRevoked(listener: RevocationListener): void { listeners.add(listener); }
export function revokeCredentialLeases(credentialId: string): void { for (const listener of listeners) listener(credentialId); }
