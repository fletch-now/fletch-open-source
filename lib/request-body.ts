export class RequestBodyTooLargeError extends Error {
  constructor() { super("Request body exceeds its size limit."); this.name = "RequestBodyTooLargeError"; }
}
export async function readBoundedJson(request: Request, maxBytes: number, options: { allowEmpty?: boolean } = {}): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestBodyTooLargeError();
  const reader = request.body?.getReader();
  if (!reader) return options.allowEmpty ? {} : null;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new RequestBodyTooLargeError(); }
      chunks.push(value);
    }
    // An empty POST may arrive as a non-null stream through the HTTP adapter.
    // Opt in only for endpoints whose request body is optional.
    if (bytes === 0 && options.allowEmpty) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return null; }
  } finally { reader.releaseLock(); }
}
