import { guildUrl, type SharedAsset } from "./shared";
import { workshopRequest } from "./workshop-request";

export type AssetUploadTicket = { id: string; uploadUrl: string; uploaded?: boolean };
export async function reserveAssetUpload(name: string, guildId: string) {
  return workshopRequest<AssetUploadTicket>(guildUrl("/api/emoji/assets", guildId), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
  });
}
export async function sendAssetUpload(ticket: AssetUploadTicket, file: File, guildId: string) {
  if (!ticket.uploaded) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 60_000);
    try {
      // No site cookie, Supabase API key, or Authorization header is sent to Storage.
      const response = await fetch(ticket.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type, "x-upsert": "false" }, credentials: "omit", referrerPolicy: "no-referrer", signal: timeout.signal });
      // A retry after an uncertain upload may find the immutable object already present.
      let duplicate = response.status === 409;
      if (!response.ok && !duplicate) {
        const value = await response.json().catch(() => null);
        duplicate = value?.error === "Duplicate" || value?.statusCode === "409";
      }
      if (!response.ok && !duplicate) throw new Error("画像を送信できませんでした。接続を確認して再試行してください。");
      ticket.uploaded = true;
    } catch (error) {
      if (timeout.signal.aborted) throw new Error("画像の送信がタイムアウトしました。接続を確認して再試行してください。");
      throw error;
    } finally { clearTimeout(timer); }
  }
  return workshopRequest<{ asset: SharedAsset }>(guildUrl("/api/emoji/assets/" + ticket.id + "/complete", guildId), { method: "POST" });
}
