import { api, ApiError, privateJson } from "@/lib/server/http";
import { assetStore, signedAssets, uploadAsset, type AssetRow } from "@/lib/server/shared-assets";
import { requireMember } from "@/lib/server/workshop-session";
import { requireSameOrigin } from "@/lib/server/workshop-config";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return api(async () => {
    const member = await requireMember(request);
    const offset = Number(new URL(request.url).searchParams.get("offset") || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 500) throw new ApiError(400, "invalid_page", "ページ指定が不正です。");
    const store = assetStore();
    const { data, error } = await store.from("emoji_assets").select("*").eq("guild_id", member.guild.id).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 39);
    if (error) throw error;
    return privateJson({ assets: await signedAssets(store, data as AssetRow[], member), nextOffset: data.length === 40 ? offset + 40 : null });
  });
}
export async function POST(request: Request) {
  return api(async () => {
    requireSameOrigin(request);
    const member = await requireMember(request, true);
    return privateJson({ asset: await uploadAsset(request, member) }, 201);
  });
}
