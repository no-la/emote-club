import "server-only";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { discordGuild } from "./discord";
import { ApiError } from "./http";
import { requireAuthConfig } from "./workshop-config";

export type Member = { user: { id: string; name: string }; guild: { id: string; name: string; isAdmin: boolean; canManageGuild?: boolean; canCreateEmoji?: boolean } };
type LoginSession = { user: Member["user"]; guild?: Member["guild"] } & { token: string; expiresAt: number; checkedAt: number };
type OAuthAttempt = { state: string; verifier: string; createdAt: number };
export async function loginSession() {
  const config = requireAuthConfig();
  return getIronSession<LoginSession>(await cookies(), {
    password: config.password, cookieName: config.secure ? "__Host-workshop" : "workshop", ttl: 7 * 86400,
    cookieOptions: { httpOnly: true, secure: config.secure, sameSite: "lax", path: "/" },
  });
}
export async function oauthAttempt() {
  const config = requireAuthConfig();
  return getIronSession<OAuthAttempt>(await cookies(), {
    password: config.password, cookieName: config.secure ? "__Host-workshop-oauth" : "workshop-oauth", ttl: 600,
    cookieOptions: { httpOnly: true, secure: config.secure, sameSite: "lax", path: "/" },
  });
}
export async function requireLogin() {
  const session = await loginSession();
  if (!session.user?.id || !session.token || !session.expiresAt || session.expiresAt <= Date.now()) {
    session.destroy();
    throw new ApiError(401, "login_required", "Discordにログインしてください。");
  }
  return session;
}
export async function requireMember(request: Request, fresh = false): Promise<Member> {
  const session = await requireLogin();
  // Explicit request scope prevents another tab's server selection changing a mutation's destination.
  const guildId = new URL(request.url).searchParams.get("guildId");
  if (!guildId || !/^\d{17,20}$/.test(guildId)) throw new ApiError(400, "guild_required", "サーバーを選んでください。");
  if (fresh || session.guild?.id !== guildId || !session.checkedAt || Date.now() - session.checkedAt >= 60_000) {
    try {
      session.guild = await discordGuild(session.token!, guildId);
      session.checkedAt = Date.now();
      await session.save();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) session.destroy();
      throw error;
    }
  }
  return { user: session.user!, guild: session.guild! };
}
