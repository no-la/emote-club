import { createHash, randomBytes } from "node:crypto";
import { api } from "@/lib/server/http";
import { canonicalHost, requireAuthConfig } from "@/lib/server/workshop-config";
import { oauthAttempt } from "@/lib/server/workshop-session";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return api(async () => {
    const config = requireAuthConfig();
    // Keep the callback and its state cookie on the configured origin, including localhost.
    if (!canonicalHost(request)) return Response.redirect(new URL("/api/auth/discord", config.origin), 303);
    const attempt = await oauthAttempt();
    attempt.state = randomBytes(32).toString("base64url");
    attempt.verifier = randomBytes(32).toString("base64url");
    attempt.createdAt = Date.now();
    await attempt.save();
    const url = new URL("https://discord.com/oauth2/authorize");
    url.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri, scope: "identify guilds", state: attempt.state, code_challenge: createHash("sha256").update(attempt.verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
    return new Response(null, { status: 303, headers: { Location: url.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  });
}
