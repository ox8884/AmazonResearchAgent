export const MAX_BOUNDED_JSON_BYTES = 64 * 1024;

export type BoundedJsonResult =
  | { readonly kind: 'json'; readonly value: unknown }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'too_large' };

function contentLengthExceedsLimit(contentLength: string | null, maxBytes: number): boolean {
  if (contentLength === null) return false;
  const parsed = Number(contentLength);
  return Number.isFinite(parsed) && parsed > maxBytes;
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number = MAX_BOUNDED_JSON_BYTES
): Promise<BoundedJsonResult> {
  if (contentLengthExceedsLimit(request.headers.get('content-length'), maxBytes)) {
    return { kind: 'too_large' };
  }
  if (request.body === null) return { kind: 'invalid' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        return { kind: 'too_large' };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    const value: unknown = JSON.parse(text);
    return { kind: 'json', value };
  } catch {
    return { kind: 'invalid' };
  }
}
