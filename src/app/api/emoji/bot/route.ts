import { api, privateJson } from "@/lib/server/http";
import { requireMember } from "@/lib/server/workshop-session";
import { requireAuthConfig } from "@/lib/server/workshop-config";
import { discordBotInstalled } from "@/lib/server/discord-bot";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return api(async () => {
    const { guild } = await requireMember(request, true);
    const installed = await discordBotInstalled(guild.id);
    const inviteUrl = !installed
      ? `https://discord.com/oauth2/authorize?client_id=${requireAuthConfig().clientId}&scope=bot&permissions=8796093022208&guild_id=${guild.id}&disable_guild_select=true`
      : null;
    return privateJson({ installed, inviteUrl });
  });
}
