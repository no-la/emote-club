import { api, privateJson } from "@/lib/server/http";
import { revokeDiscordToken } from "@/lib/server/discord";
import { requireSameOrigin } from "@/lib/server/workshop-config";
import { loginSession, oauthAttempt } from "@/lib/server/workshop-session";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return api(async () => {
    requireSameOrigin(request);
    const session = await loginSession();
    const token = session.token;
    session.destroy();
    (await oauthAttempt()).destroy();
    if (token) await revokeDiscordToken(token).catch(() => console.error("Discord token revocation failed"));
    return privateJson({ ok: true });
  });
}
