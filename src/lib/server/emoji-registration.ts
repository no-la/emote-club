import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { EMOJI_UPLOAD_BYTES, emojiName, type RegistrationResult } from "@/lib/emoji/registration";
import { api, ApiError, limitedBody, privateJson } from "./http";
import { assetStore } from "./shared-assets";
import { registrationConfigured, requireSameOrigin } from "./workshop-config";
import { requireMember, type Member } from "./workshop-session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const messages: Record<string, string> = {
  bot_access: "Botがサーバーに参加していることと「絵文字を作成」権限を確認してください。",
  bot_token: "Botの接続設定を確認してください。",
  emoji_full: "サーバーの絵文字枠がいっぱいです。不要な絵文字をDiscordで整理してください。",
  name_exists: "同じ名前の絵文字があります。別の名前にしてください。",
  discord_rate_limit: "Discordの登録制限中です。表示された時間を待ってから再試行してください。",
  discord_rejected: "Discordが画像または名前を受け付けませんでした。内容を確認してください。",
  discord_unavailable: "Discordに接続できませんでした。少し待ってから再試行してください。",
  unknown: "登録結果を確認できません。重複を避けるため再送していません。Discordの絵文字一覧を確認してください。",
};
type Attempt = {
  request_id: string; guild_id: string; user_id: string; name: string; fingerprint: string;
  status: RegistrationResult["status"]; emoji_id: string | null; error_code: string | null;
  retry_at: string | null; created_at: string;
};
function result(row: Attempt): RegistrationResult {
  const status = row.status === "pending" && Date.now() - Date.parse(row.created_at) > 60_000 ? "unknown" : row.status;
  return { requestId: row.request_id, name: row.name, status, emojiId: row.emoji_id,
    message: status === "succeeded" ? "サーバーに絵文字を追加しました。" : status === "pending" ? "登録処理中です。少し待って結果を確認してください。" : messages[row.error_code || status] || messages.unknown,
    retryAfter: row.retry_at ? Math.max(0, Math.ceil((Date.parse(row.retry_at) - Date.now()) / 1000)) : 0 };
}
export function requireEmojiCreator(member: Member) {
  if (!member.guild.canCreateEmoji) throw new ApiError(403, "emoji_forbidden", "登録にはサーバーの「絵文字を作成」権限が必要です。");
}
export async function normalizeEmoji(input: Uint8Array) {
  if (!input.byteLength || input.byteLength > EMOJI_UPLOAD_BYTES) throw new ApiError(413, "emoji_too_large", "絵文字は256 KiB以下のPNGにしてください。");
  try {
    const bytes = Buffer.from(input);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("not PNG");
    // Reject APNG even if its fallback image happens to decode as one static page.
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = bytes.readUInt32BE(offset);
      if (bytes.toString("ascii", offset + 4, offset + 8) === "acTL") throw new Error("animated PNG");
      offset += size + 12;
    }
    const image = sharp(bytes, { limitInputPixels: 128 * 128, failOn: "warning" });
    const meta = await image.metadata();
    if (meta.format !== "png" || meta.width !== 128 || meta.height !== 128 || (meta.pages ?? 1) !== 1) throw new Error("invalid dimensions");
    const png = await image.png().toBuffer();
    if (png.length > EMOJI_UPLOAD_BYTES) throw new Error("output too large");
    return png;
  } catch {
    throw new ApiError(400, "invalid_emoji", "128×128の静止PNGを送信してください。");
  }
}
export async function registrationInput(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new ApiError(400, "invalid_body", "画像と名前を指定してください。");
  const body = await limitedBody(request, EMOJI_UPLOAD_BYTES + 16 * 1024);
  let form: FormData;
  try { form = await new Response(body, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData(); }
  catch { throw new ApiError(400, "invalid_body", "画像を読み込めませんでした。"); }
  const name = emojiName(form.get("name"));
  const requestId = form.get("requestId");
  const file = form.get("file");
  if (!name || typeof requestId !== "string" || !UUID.test(requestId) || !(file instanceof File)) throw new ApiError(400, "invalid_registration", "名前は半角英数字・アンダースコアの2〜32文字にしてください。");
  const png = await normalizeEmoji(new Uint8Array(await file.arrayBuffer()));
  const fingerprint = createHash("sha256").update(name).update("\0").update(png).digest("hex");
  return { name, requestId, png, fingerprint };
}
function seconds(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
}
function cooldown(response: Response, body: { retry_after?: unknown }) {
  return Math.max(seconds(response.headers.get("Retry-After")), seconds(body.retry_after),
    response.headers.get("X-RateLimit-Remaining") === "0" ? seconds(response.headers.get("X-RateLimit-Reset-After")) : 0);
}
function failure(response: Response, body: { code?: number }) {
  if (response.status === 401) return "bot_token";
  if (response.status === 403 || response.status === 404) return "bot_access";
  if (response.status === 429) return "discord_rate_limit";
  if (body.code === 30008) return "emoji_full";
  return response.status >= 500 ? "discord_unavailable" : "discord_rejected";
}
export async function registerEmoji(input: Awaited<ReturnType<typeof registrationInput>>, member: Member) {
  requireEmojiCreator(member);
  if (!registrationConfigured()) throw new ApiError(503, "registration_not_configured", "サーバーへの登録は準備中です。");
  const store = assetStore();
  const reserved = await store.rpc("reserve_emoji_registration", { request: input.requestId, guild: member.guild.id, actor: member.user.id, emoji_name: input.name, digest: input.fingerprint });
  if (reserved.error) {
    const reason = reserved.error.message;
    if (reason.includes("request_conflict")) throw new ApiError(409, "request_conflict", "登録内容が変わっています。ダイアログを開き直してください。");
    if (reason.includes("registration_unresolved")) throw new ApiError(409, "registration_unresolved", messages.unknown);
    if (reason.includes("registration_busy")) throw new ApiError(409, "registration_busy", "サーバーで別の登録を処理中です。少し待ってください。");
    if (reason.includes("registration_throttled")) throw new ApiError(429, "registration_throttled", "登録操作は10分間に5回までです。時間を置いてお試しください。");
    throw new ApiError(503, "registration_store_unavailable", "登録記録を利用できません。接続設定とDBの更新を確認してください。");
  }
  const reservation = reserved.data as { claimed: boolean; attempt?: Attempt; retryAfter?: number };
  if (reservation.retryAfter) throw new ApiError(429, "discord_cooldown", `Discordの登録制限中です。あと${reservation.retryAfter}秒待ってください。`);
  if (!reservation.attempt) throw new Error("Missing registration reservation");
  const row = reservation.attempt;
  if (!reservation.claimed) return result(row);
  const token = process.env.DISCORD_BOT_TOKEN!;
  const url = `https://discord.com/api/v10/guilds/${member.guild.id}/emojis`;
  let sent = false;
  let retryAfter = 0;
  let status: Attempt["status"] = "failed";
  let errorCode: string | null = "discord_unavailable";
  let emojiId: string | null = null;
  try {
    const existing = await fetch(url, { headers: { Authorization: `Bot ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const list = await existing.json();
    retryAfter = cooldown(existing, list);
    if (!existing.ok) errorCode = failure(existing, list);
    else if (!Array.isArray(list)) throw new Error("Invalid emoji list");
    else if (list.some(item => typeof item.name === "string" && item.name.toLowerCase() === input.name.toLowerCase())) errorCode = "name_exists";
    else if (retryAfter) errorCode = "discord_rate_limit";
    else {
      sent = true;
      const response = await fetch(url, { method: "POST", headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", "X-Audit-Log-Reason": encodeURIComponent(`Emoji workshop user ${member.user.id}; request ${input.requestId}`) },
        body: JSON.stringify({ name: input.name, image: `data:image/png;base64,${input.png.toString("base64")}`, roles: [] }), cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const body = await response.json();
      retryAfter = cooldown(response, body);
      if (response.ok && typeof body.id === "string" && /^\d{17,20}$/.test(body.id) && body.name === input.name) { status = "succeeded"; emojiId = body.id; errorCode = null; }
      else if (response.status >= 400 && response.status < 500 && response.status !== 408) errorCode = failure(response, body);
      else { status = "unknown"; errorCode = "unknown"; }
    }
  } catch { if (sent) { status = "unknown"; errorCode = "unknown"; } }
  if (errorCode === "discord_rate_limit" && !retryAfter) retryAfter = 60;
  const change = { status, emoji_id: emojiId, error_code: errorCode, retry_at: retryAfter ? new Date(Date.now() + retryAfter * 1000).toISOString() : null };
  // If recording fails, leave pending durable. Never resend the Discord mutation.
  const saved = await store.from("emoji_registrations").update(change).eq("request_id", row.request_id).eq("status", "pending").select("*").single();
  if (saved.error) return result({ ...row, status: "unknown", error_code: "unknown" });
  return result(saved.data as Attempt);
}
export async function registrationStatus(requestId: string, member: Member) {
  requireEmojiCreator(member);
  if (!UUID.test(requestId)) throw new ApiError(400, "invalid_request", "登録番号が不正です。");
  const { data, error } = await assetStore().from("emoji_registrations").select("*").eq("request_id", requestId).eq("guild_id", member.guild.id).eq("user_id", member.user.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "registration_not_found", "登録記録が見つかりません。まだ処理中の場合は少し待って再確認してください。");
  return result(data as Attempt);
}
export async function registrationPost(request: Request) {
  return api(async () => {
    requireSameOrigin(request);
    const member = await requireMember(request, true);
    requireEmojiCreator(member);
    return privateJson(await registerEmoji(await registrationInput(request), member));
  });
}
