import { assetName } from "@/lib/emoji/shared";
import { api, ApiError, limitedBody, privateJson } from "@/lib/server/http";
import { assetPath, assetStore, BUCKET, findAsset, signedAssets, requireAssetManager, type AssetRow } from "@/lib/server/shared-assets";
import { requireMember } from "@/lib/server/workshop-session";
import { requireSameOrigin } from "@/lib/server/workshop-config";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return api(async () => {
    requireSameOrigin(request);
    const member = await requireMember(request, true);
    const store = assetStore();
    const row = await findAsset(store, (await context.params).id, member);
    requireAssetManager(row, member);
    let value: unknown;
    try { value = JSON.parse((await limitedBody(request, 2048)).toString()); }
    catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, "invalid_name", "素材名を指定してください。"); }
    const name = assetName(value && typeof value === "object" && "name" in value ? value.name : null);
    if (!name) throw new ApiError(400, "invalid_name", "素材名は1〜80文字で指定してください。");
    const { data, error } = await store.from("emoji_assets").update({ name }).eq("guild_id", member.guild.id).eq("id", row.id).eq("status", "ready").select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(409, "asset_busy", "素材は処理中です。一覧を更新してください。");
    return privateJson({ asset: (await signedAssets(store, [data as AssetRow], member))[0] });
  });
}
export async function DELETE(request: Request, context: Context) {
  return api(async () => {
    requireSameOrigin(request);
    const member = await requireMember(request, true);
    const store = assetStore();
    const row = await findAsset(store, (await context.params).id, member);
    requireAssetManager(row, member);
    if (row.status === "pending" && Date.now() - Date.parse(row.created_at) < 10 * 60_000) throw new ApiError(409, "asset_busy", "素材を登録中です。中断した登録は10分後に削除できます。");
    const marked = await store.from("emoji_assets").update({ status: "deleting" }).eq("guild_id", member.guild.id).eq("id", row.id);
    if (marked.error) throw marked.error;
    const removed = await store.storage.from(BUCKET).remove([assetPath(row)]);
    if (removed.error) throw removed.error;
    const deleted = await store.from("emoji_assets").delete().eq("guild_id", member.guild.id).eq("id", row.id).eq("status", "deleting");
    if (deleted.error) throw deleted.error;
    return privateJson({ ok: true });
  });
}
