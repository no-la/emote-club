import "server-only";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) { super(message); }
}
export function privateJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } });
}
export async function api(handler: () => Promise<Response>) {
  try { return await handler(); }
  catch (error) {
    if (error instanceof ApiError) {
      const response = privateJson({ error: error.message, code: error.code, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) }, error.status);
      if (error.retryAfter) response.headers.set("Retry-After", String(error.retryAfter));
      return response;
    }
    // Provider errors may contain credentials or user data; never return/log their bodies.
    console.error("Workshop API request failed", error instanceof Error ? error.name : "unknown");
    return privateJson({ error: "処理できませんでした。少し待って再試行してください。", code: "unavailable" }, 503);
  }
}
export async function limitedBody(request: Request, limit: number) {
  const length = Number(request.headers.get("content-length"));
  if (length > limit) throw new ApiError(413, "too_large", "ファイルが大きすぎます。");
  if (!request.body) throw new ApiError(400, "empty_body", "入力がありません。");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ApiError(413, "too_large", "ファイルが大きすぎます。"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
