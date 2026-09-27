// The API key scopes, in a module with no server dependencies so client
// components can render the scope list without dragging in the database driver.

export const API_KEY_SCOPES = [
  "registry:read",
  "watchers:read",
  "watchers:write",
  "builds:read",
  "projects:read",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}
