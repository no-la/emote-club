export class WorkshopRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// Cover response headers and body reading. Never retry mutations automatically:
// a lost response does not mean the server failed to save the asset.
export async function workshopRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const mutation = !["GET", "HEAD"].includes((options?.method || "GET").toUpperCase());
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), mutation ? 60_000 : 20_000);
  const signal = options?.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
  try {
    const response = await fetch(url, { ...options, cache: "no-store", signal });
    const value = await response.json();
    if (!response.ok) throw new WorkshopRequestError(value.error || "処理できませんでした。もう一度お試しください。", response.status);
    return value as T;
  } catch (error) {
    if (timeout.signal.aborted) throw new WorkshopRequestError(mutation
      ? "通信がタイムアウトしました。処理が完了している可能性があります。閉じて一覧や登録結果を確認してから再操作してください。"
      : "通信がタイムアウトしました。接続を確認して、もう一度お試しください。", 408);
    throw error;
  } finally { clearTimeout(timer); }
}
