import { api, privateJson } from "@/lib/server/http";
import { requireLogin } from "@/lib/server/workshop-session";
import { discordGuilds } from "@/lib/server/discord";
import { requireAuthConfig } from "@/lib/server/workshop-config";
import { guildAdministrator } from "@/lib/emoji/shared";
export const runtime = "nodejs";
export async function GET() { return api(async () => {
  const session = await requireLogin();
  const guilds = await discordGuilds(session.token!);
  return privateJson({guilds: guilds.map(g => ({id:g.id, name:g.name,
    inviteUrl: guildAdministrator(g) || (BigInt(g.permissions || "0") & BigInt(32)) !== BigInt(0)
      ? `https://discord.com/oauth2/authorize?client_id=${requireAuthConfig().clientId}&scope=bot&permissions=8796093022208&guild_id=${g.id}&disable_guild_select=true` : null
  }))});
}); }
