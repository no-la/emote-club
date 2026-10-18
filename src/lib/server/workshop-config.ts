import "server-only";
import { ApiError } from "./http";

export function authConfig() {
  const { SITE_URL, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SESSION_PASSWORD } = process.env;
  if (!SITE_URL || !DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !SESSION_PASSWORD || SESSION_PASSWORD.length < 32) return null;
  try {
    const site = new URL(SITE_URL);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname);
    if (site.protocol !== "https:" && !(site.protocol === "http:" && local)) return null;
    if (site.username || site.password || !/^\d{17,20}$/.test(DISCORD_CLIENT_ID)) return null;
    return { origin: site.origin, clientId: DISCORD_CLIENT_ID, clientSecret: DISCORD_CLIENT_SECRET, password: SESSION_PASSWORD, secure: site.protocol === "https:", redirectUri: new URL("/api/auth/discord/callback", site.origin).href };
  } catch { return null; }
}
export function requireAuthConfig() {
  const config = authConfig();
  if (!config) throw new ApiError(503, "auth_not_configured", "Discordログインは準備中です。");
  return config;
}
export function storageConfigured() { return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY); }
export function canonicalHost(request: Request) {
  // Enable only behind a proxy that overwrites X-Forwarded-Host with the public host.
  // Do not accept a list or fall back to Host when that deployment contract is enabled.
  const host = process.env.TRUST_PROXY_HOST === "1"
    ? request.headers.get("x-forwarded-host")
    : request.headers.get("host") || new URL(request.url).host;
  return host === new URL(requireAuthConfig().origin).host;
}
export function requireSameOrigin(request: Request) {
  const config = requireAuthConfig();
  if (request.headers.get("origin") !== config.origin || !canonicalHost(request)) {
    throw new ApiError(403, "invalid_origin", "サイトを開き直してから操作してください。");
  }
}

export function registrationConfigured() { return Boolean(authConfig() && storageConfigured() && process.env.DISCORD_BOT_TOKEN); }
