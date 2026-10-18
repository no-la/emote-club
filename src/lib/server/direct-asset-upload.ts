import "server-only";
import { assetName, SHARED_IMAGE_BYTES } from "@/lib/emoji/shared";
import { ApiError, limitedBody } from "./http";
import { assetStore, assetPath, BUCKET, findAsset, signedAssets, type AssetRow } from "./shared-assets";
import { normalizeSharedImage } from "./shared-image";
import type { Member } from "./workshop-session";

export const STAGING_BUCKET = "emoji-upload-staging";
type UploadRow = { id: string; guild_id: string; owner_id: string; state: string; created_at: string; expires_at: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stagingPath = (row: Pick<UploadRow, "guild_id" | "id">) => row.guild_id + "/" + row.id;

export async function beginAssetUpload(request: Request, member: Member) {
  let value: unknown;
  try { value = JSON.parse((await limitedBody(request, 2048)).toString()); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, "invalid_asset", "素材名を指定してください。"); }
  const name = assetName(value && typeof value === "object" && "name" in value ? value.name : null);
  if (!name) throw new ApiError(400, "invalid_asset", "素材名は1〜80文字で指定してください。");
  const store = assetStore();
  const { data, error } = await store.rpc("reserve_emoji_asset_upload", { asset_id: crypto.randomUUID(), guild: member.guild.id, actor: member.user.id, actor_name: member.user.name, asset_name: name }).single();
  if (error) {
    if (error.message.includes("upload_throttled")) throw new ApiError(429, "upload_throttled", "アップロードが多すぎます。少し時間を置いてお試しください（1時間に10回まで）。");
    if (error.message.includes("asset_quota_exceeded")) throw new ApiError(409, "quota_exceeded", "共有素材の容量か件数の上限に達しました。一時アップロードの予約容量は期限後に解放されます。");
    if (error.message.includes("project_quota_exceeded")) throw new ApiError(503, "project_quota_exceeded", "サービスの保存容量の上限に達しました。");
    throw error;
  }
  const row = data as UploadRow;
  // Never reissue tokens for the same reservation. Cleanup's 3h window exceeds the 2h token TTL.
  if (Date.now() - Date.parse(row.created_at) > 60_000) throw new ApiError(409, "upload_expired", "アップロードの準備が期限切れです。やり直してください。");
  const signed = await store.storage.from(STAGING_BUCKET).createSignedUploadUrl(stagingPath(row), { upsert: false });
  if (signed.error) throw signed.error; // Ambiguous result: retain the reservation until cleanup.
  return { id: row.id, uploadUrl: signed.data.signedUrl };
}

export async function completeAssetUpload(id: string, member: Member) {
  if (!UUID.test(id)) throw new ApiError(404, "upload_not_found", "アップロードが見つかりません。");
  const store = assetStore();
  const lookup = await store.from("emoji_asset_uploads").select("*").eq("id", id).eq("guild_id", member.guild.id).eq("owner_id", member.user.id).maybeSingle();
  if (lookup.error) throw lookup.error;
  if (!lookup.data) throw new ApiError(404, "upload_not_found", "アップロードが見つかりません。");
  const upload = lookup.data as UploadRow;
  const row = await findAsset(store, id, member);
  if (row.status === "ready") return (await signedAssets(store, [row], member))[0];
  // Finish before the existing 10-minute pending-delete window, with time for bounded processing.
  if (row.status !== "pending" || Date.now() - Date.parse(upload.created_at) > 9 * 60_000)
    throw new ApiError(409, "upload_expired", "登録の有効時間が過ぎました。画像を選び直してください。");
  const claim = await store.from("emoji_asset_uploads").update({ state: "processing" }).eq("id", id).eq("guild_id", member.guild.id).eq("owner_id", member.user.id).eq("state", "pending").select("id").maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) throw new ApiError(409, "upload_busy", "登録は処理中、または中断されています。一覧を更新してください。");
  // Claim once: repeated finalize calls never repeatedly decode attacker-controlled bytes.
  try {
    const downloaded = await store.storage.from(STAGING_BUCKET).download(stagingPath(upload));
    if (downloaded.error) throw downloaded.error;
    if (downloaded.data.size > SHARED_IMAGE_BYTES) throw new ApiError(413, "too_large", "共有画像は4 MiB以下にしてください。");
    const image = await normalizeSharedImage(new Uint8Array(await downloaded.data.arrayBuffer()));
    const saved = await store.storage.from(BUCKET).upload(assetPath(row), image.data, { contentType: "image/webp", upsert: false, cacheControl: "0" });
    if (saved.error) throw saved.error;
    const completed = await store.from("emoji_assets").update({ status: "ready", bytes: image.data.byteLength, width: image.width, height: image.height }).eq("id", id).eq("guild_id", member.guild.id).eq("owner_id", member.user.id).eq("status", "pending").select("*").single();
    if (completed.error) throw completed.error;
    await store.from("emoji_asset_uploads").update({ state: "ready" }).eq("id", id);
    return (await signedAssets(store, [completed.data as AssetRow], member))[0];
  } catch (error) {
    await store.from("emoji_asset_uploads").update({ state: "failed" }).eq("id", id);
    // Do not delete staging while its signed token is live (it could be uploaded again).
    throw error;
  }
}

/** Opportunistic, bounded cleanup on authenticated listing/upload. Never release quota first. */
export async function cleanupAssetUploads() {
  const store = assetStore(AbortSignal.timeout(5_000));
  const expired = await store.from("emoji_asset_uploads").select("*").lt("expires_at", new Date().toISOString()).order("expires_at").limit(5);
  if (expired.error) throw expired.error;
  for (const upload of expired.data as UploadRow[]) {
    const staged = await store.storage.from(STAGING_BUCKET).remove([stagingPath(upload)]);
    if (staged.error) continue;
    const asset = await store.from("emoji_assets").select("status").eq("id", upload.id).eq("guild_id", upload.guild_id).maybeSingle();
    if (asset.error) continue;
    if (asset.data?.status !== "ready") {
      const removed = await store.storage.from(BUCKET).remove([assetPath(upload)]);
      if (removed.error) continue;
      const deleted = await store.from("emoji_assets").delete().eq("id", upload.id).eq("guild_id", upload.guild_id).neq("status", "ready");
      if (deleted.error) continue;
    }
    const released = await store.from("emoji_asset_uploads").delete().eq("id", upload.id).lt("expires_at", new Date().toISOString());
    if (released.error) throw released.error;
  }
}
