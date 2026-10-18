import { api, privateJson } from "@/lib/server/http";
import { completeAssetUpload } from "@/lib/server/direct-asset-upload";
import { requireMember } from "@/lib/server/workshop-session";
import { requireSameOrigin } from "@/lib/server/workshop-config";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    requireSameOrigin(request);
    const member = await requireMember(request, true);
    return privateJson({ asset: await completeAssetUpload((await context.params).id, member) }, 201);
  });
}
