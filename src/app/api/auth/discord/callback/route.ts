import { timingSafeEqual } from "node:crypto";
import { api, ApiError } from "@/lib/server/http";
import { discordRequest, exchangeDiscordCode, revokeDiscordToken } from "@/lib/server/discord";
import { requireAuthConfig } from "@/lib/server/workshop-config";
import { loginSession, oauthAttempt } from "@/lib/server/workshop-session";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return api(async () => {
    let token: string | undefined;
    const config = requireAuthConfig();
    const target = new URL("/", config.origin);
    try {
      const params = new URL(request.url).searchParams;
      const attempt = await oauthAttempt();
      const { state, verifier, createdAt } = attempt;
      attempt.destroy();
      const returnedState = Buffer.from(params.get("state") || "");
      const expectedState = Buffer.from(state || "");
      if (!state || !verifier || !createdAt || Date.now() - createdAt > 600_000 || returnedState.length !== expectedState.length || !timingSafeEqual(returnedState, expectedState)) throw new ApiError(400, "invalid_state", "ログインをやり直してください。");
      if (params.get("iss") !== "https://discord.com") throw new ApiError(400, "invalid_state", "認証元を確認できませんでした。");
      if (params.has("error")) throw new ApiError(400, "cancelled", "ログインをキャンセルしました。");
      const code = params.get("code");
      if (!code) throw new ApiError(400, "oauth_failed", "認証コードがありません。");
      const access = await exchangeDiscordCode(code, verifier);
      token = access.token;
      const user: { id: string; username: string; global_name?: string | null } = await (await discordRequest("/users/@me", token)).json();
      if (!/^\d{17,20}$/.test(user.id) || typeof user.username !== "string") throw new Error("Invalid Discord user");
      const session = await loginSession();
      session.user = { id: user.id, name: (user.global_name || user.username).slice(0, 80) };
      delete session.guild;
      session.token = token;
      session.expiresAt = access.expiresAt;
      session.checkedAt = Date.now();
      await session.save();
    } catch (error) {
      if (token) await revokeDiscordToken(token).catch(() => undefined);
      target.searchParams.set("auth_error", error instanceof ApiError ? error.code : "oauth_failed");
    }
    return new Response(null, { status: 303, headers: { Location: target.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  });
}
