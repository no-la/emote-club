import { api, privateJson } from "@/lib/server/http";
import { requireLogin } from "@/lib/server/workshop-session";
import { discordGuilds } from "@/lib/server/discord";
export const runtime = "nodejs";
export async function GET() { return api(async () => {
  const session = await requireLogin();
  const guilds = await discordGuilds(session.token!);
  return privateJson({ guilds: guilds.map(g => ({ id: g.id, name: g.name })) });
}); }
