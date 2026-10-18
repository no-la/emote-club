import "server-only";
import { createClient } from "@supabase/supabase-js";
import { assetName, canManageAsset, SHARED_IMAGE_BYTES, type SharedAsset } from "@/lib/emoji/shared";
import { ApiError, limitedBody } from "./http";
import { normalizeSharedImage } from "./shared-image";
import type { Member } from "./workshop-session";
import { storageConfigured } from "./workshop-config";

export const BUCKET = "emoji-assets";
export type AssetRow = {
  id: string; guild_id: string; owner_id: string; owner_name: string; name: string;
  bytes: number; width: number; height: number; status: SharedAsset["status"]; created_at: string;
};
export function assetStore(signal?: AbortSignal) {
  if (!storageConfigured()) throw new ApiError(503, "storage_not_configured", "共有素材は準備中です。");
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(init?.signal ? [init.signal] : []), ...(signal ? [signal] : [])]) }) },
  });
}
export function publicAsset(row: AssetRow, member: Member): SharedAsset {
  return { id: row.id, name: row.name, ownerId: row.owner_id, ownerName: row.owner_name, bytes: row.bytes, width: row.width, height: row.height, status: row.status, createdAt: row.created_at, canManage: canManageAsset(row.owner_id, member.user.id, member.guild.isAdmin) };
}
export function assetPath(row: Pick<AssetRow, "id" | "guild_id">) { return `${row.guild_id}/${row.id}.webp`; }
export async function findAsset(store: ReturnType<typeof assetStore>, id: string, member: Member) {
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) throw new ApiError(404, "asset_not_found", "素材が見つかりません。");
  const { data, error } = await store.from("emoji_assets").select("*").eq("guild_id", member.guild.id).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "asset_not_found", "素材が見つかりません。");
  return data as AssetRow;
}
export function requireAssetManager(row: AssetRow, member: Member) {
  if (!canManageAsset(row.owner_id, member.user.id, member.guild.isAdmin)) throw new ApiError(403, "asset_forbidden", "この素材を変更できるのは登録した本人か管理者です。");
}
export async function uploadAsset(request: Request, member: Member) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("multipart/form-data;")) throw new ApiError(400, "invalid_body", "画像を選んでください。");
  const body = await limitedBody(request, SHARED_IMAGE_BYTES + 64 * 1024);
  let form: FormData;
  try { form = await new Response(body, { headers: { "Content-Type": contentType } }).formData(); }
  catch { throw new ApiError(400, "invalid_body", "画像を読み込めませんでした。"); }
  const file = form.get("file");
  const name = assetName(form.get("name"));
  if (!(file instanceof File) || !name) throw new ApiError(400, "invalid_asset", "画像と素材名（80文字まで）を指定してください。");
  const image = await normalizeSharedImage(new Uint8Array(await file.arrayBuffer()));
  const store = assetStore();
  const id = crypto.randomUUID();
  const { data, error } = await store.rpc("reserve_emoji_asset", { asset_id: id, guild: member.guild.id, actor: member.user.id, actor_name: member.user.name, asset_name: name, asset_bytes: image.data.byteLength, asset_width: image.width, asset_height: image.height }).single();
  if (error) {
    if (error.message.includes("asset_quota_exceeded")) throw new ApiError(409, "quota_exceeded", "共有素材の容量か件数の上限に達しました。不要な素材を削除してください。");
    if (error.message.includes("project_quota_exceeded")) throw new ApiError(503, "project_quota_exceeded", "サービスの保存容量の上限に達しました。");
    throw error;
  }
  const row = data as AssetRow;
  const path = assetPath(row);
  const uploaded = await store.storage.from(BUCKET).upload(path, image.data, { contentType: "image/webp", upsert: false, cacheControl: "0" });
  if (uploaded.error) {
    // Upload errors can be ambiguous. Remove storage first; keep the reservation if cleanup fails.
    const removed = await store.storage.from(BUCKET).remove([path]);
    if (!removed.error) await store.from("emoji_assets").delete().eq("guild_id", member.guild.id).eq("id", id).eq("status", "pending");
    throw uploaded.error;
  }
  const completed = await store.from("emoji_assets").update({ status: "ready" }).eq("guild_id", member.guild.id).eq("id", id).eq("status", "pending").select("*").single();
  // On an uncertain DB result, retain the object and its quota reservation for retry/cleanup.
  if (completed.error) throw completed.error;
  return (await signedAssets(store, [completed.data as AssetRow], member))[0];
}

// Private objects remain private; authorize the guild before signing a batch (one Storage request).
export async function signedAssets(store: ReturnType<typeof assetStore>, rows: AssetRow[], member: Member) {
  if (rows.some(row => row.guild_id !== member.guild.id)) throw new ApiError(403, "asset_forbidden", "このサーバーの素材ではありません。");
  const ready = rows.filter(row => row.status === "ready");
  const urls = new Map<string, string>();
  if (ready.length) {
    const { data, error } = await store.storage.from(BUCKET).createSignedUrls(ready.map(assetPath), 300);
    if (error) throw error;
    for (const item of data || []) {
      if (item.error || !item.path || !item.signedUrl) throw new Error("Unable to sign asset");
      urls.set(item.path, item.signedUrl);
    }
  }
  return rows.map(row => ({ ...publicAsset(row, member), imageUrl: urls.get(assetPath(row)) }));
}
