import { api, privateJson } from "@/lib/server/http";
import { authConfig, storageConfigured, registrationConfigured } from "@/lib/server/workshop-config";
import { loginSession, requireLogin, requireMember } from "@/lib/server/workshop-session";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return api(async () => {
    const configured = Boolean(authConfig());
    const base = { configured, storageConfigured: storageConfigured(), registrationConfigured: registrationConfigured(), user: null, guild: null };
    if (!configured) return privateJson(base);
    const session = await loginSession();
    if (!session.user) return privateJson(base);
    await requireLogin();
    if (!new URL(request.url).searchParams.has("guildId")) return privateJson({ ...base, user: session.user });
    return privateJson({ ...base, ...await requireMember(request) });
  });
}
