import "server-only";
import { ApiError } from "./http";

export async function discordBotInstalled(guildId: string) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new ApiError(503, "bot_not_configured", "Botの接続設定は準備中です。");
  const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
    headers: { Authorization: `Bot ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => null);
  if (response.ok && data?.id === guildId) return true;
  if ((response.status === 404 && data?.code === 10004) || (response.status === 403 && data?.code === 50001)) return false;
  // Invalid credentials, rate limits and outages do not mean the bot is absent.
  throw new ApiError(503, "bot_status_unavailable", "Botの参加状況を確認できません。少し待って再確認してください。");
}
