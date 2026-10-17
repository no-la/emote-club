import "server-only";
import { guildAdministrator, guildEmojiCreator } from "@/lib/emoji/shared";
import { ApiError } from "./http";
import { requireAuthConfig } from "./workshop-config";

const API = "https://discord.com/api/v10";
export async function discordRequest(path: string, token: string) {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (response.status === 401) throw new ApiError(401, "session_expired", "ログインの有効期限が切れました。もう一度ログインしてください。");
  if (!response.ok) throw new ApiError(503, "discord_unavailable", "Discordへ接続できません。少し待って再試行してください。");
  return response;
}
export type DiscordGuild = { id: string; name: string; owner?: boolean; permissions?: string };
export async function discordGuilds(token: string) {
  const guilds: DiscordGuild[] = [];
  let after = "";
  for (let page = 0; page < 10; page++) {
    const batch: DiscordGuild[] = await (await discordRequest(`/users/@me/guilds?limit=200${after ? `&after=${after}` : ""}`, token)).json();
    if (!Array.isArray(batch)) throw new Error("Invalid guild response");
    guilds.push(...batch);
    if (batch.length < 200) return guilds;
    const next = batch.at(-1)?.id;
    if (!next || next === after) throw new Error("Invalid guild pagination");
    after = next;
  }
  throw new ApiError(503, "discord_unavailable", "サーバー一覧を取得できませんでした。");
}
export async function discordGuild(token: string, guildId: string) {
  const guild = (await discordGuilds(token)).find(item => item.id === guildId);
  if (!guild) throw new ApiError(403, "not_member", "このサーバーのメンバーだけが共有素材を利用できます。");
  return { id: guild.id, name: guild.name, isAdmin: guildAdministrator(guild), canCreateEmoji: guildEmojiCreator(guild) };
}
export async function exchangeDiscordCode(code: string, verifier: string) {
  const config = requireAuthConfig();
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: config.redirectUri }),
  });
  if (!response.ok) throw new ApiError(401, "oauth_failed", "ログインを完了できませんでした。もう一度お試しください。");
  const data = await response.json();
  if (typeof data.access_token !== "string" || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.token_type?.toLowerCase() !== "bearer") throw new Error("Invalid Discord token response");
  if (!["identify", "guilds"].every(scope => String(data.scope).split(" ").includes(scope))) throw new ApiError(401, "oauth_failed", "必要な権限が許可されませんでした。");
  return { token: data.access_token as string, expiresAt: Date.now() + Math.min(data.expires_in, 7 * 86400) * 1000 };
}
export async function revokeDiscordToken(token: string) {
  const config = requireAuthConfig();
  const response = await fetch("https://discord.com/api/oauth2/token/revoke", {
    method: "POST", signal: AbortSignal.timeout(5000),
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, token, token_type_hint: "access_token" }),
  });
  if (!response.ok) throw new Error("Discord revocation unavailable");
}
