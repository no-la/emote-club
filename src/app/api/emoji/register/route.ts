import { api, privateJson } from "@/lib/server/http";
import { registrationPost, registrationStatus } from "@/lib/server/emoji-registration";
import { requireMember } from "@/lib/server/workshop-session";

export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = registrationPost;
export async function GET(request: Request) {
  return api(async () => privateJson(await registrationStatus(new URL(request.url).searchParams.get("requestId") || "", await requireMember(request, true))));
}
