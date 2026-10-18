import { api, privateJson } from "@/lib/server/http";
import { cancelUnstartedRegistration } from "@/lib/server/registration-upload";
import { requireMember } from "@/lib/server/workshop-session";
import { requireSameOrigin } from "@/lib/server/workshop-config";
export const runtime="nodejs";
export const maxDuration=60;
export async function POST(request:Request){return api(async()=>{requireSameOrigin(request);return privateJson(await cancelUnstartedRegistration(request,await requireMember(request,true)));});}
