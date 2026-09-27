// The fetch shape every Settings card uses: the browser session against this
// app's own routes, a null response when the request itself failed, and the
// API's { error } body read back when it did not.

export async function safeFetch(input: string, init?: RequestInit): Promise<Response | null> {
  return fetch(input, init).catch(function ignore() {
    return null;
  });
}

export async function readBody(response: Response | null): Promise<Record<string, unknown> | null> {
  if (!response) {
    return null;
  }
  return response.json().catch(function ignore() {
    return null;
  });
}
