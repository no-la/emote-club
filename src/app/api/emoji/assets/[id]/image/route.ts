import { api, ApiError } from "@/lib/server/http";
import { assetPath, assetStore, BUCKET, findAsset } from "@/lib/server/shared-assets";
import { requireMember } from "@/lib/server/workshop-session";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const member = await requireMember(request);
    const store = assetStore();
    const row = await findAsset(store, (await context.params).id, member);
    if (row.status !== "ready") throw new ApiError(404, "asset_not_found", "この素材は利用できません。");
    const { data, error } = await store.storage.from(BUCKET).download(assetPath(row));
    if (error) throw error;
    return new Response(data, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "Content-Disposition": 'inline; filename="asset.webp"' } });
  });
}
