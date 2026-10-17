import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { sealData, unsealData } from "iron-session";

// Real Next.js production routes with isolated, generated test credentials.
// Does not contact Discord/Supabase or bypass authentication in application code.
test("HTTP authentication boundary, OAuth state/PKCE, expiry and CSRF", { timeout: 45_000 }, async () => {
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = (probe.address() as { port: number }).port;
  probe.close(); await once(probe, "close");
  const origin = `http://127.0.0.1:${port}`;
  const password = randomBytes(32).toString("base64url");
  const guildId = "223456789012345678";
  const server = spawn(process.execPath, ["--import", "./tests/fixtures/discord-fetch.mjs", "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production", SITE_URL: origin, DISCORD_CLIENT_ID: "123456789012345678", DISCORD_CLIENT_SECRET: "test-only-unused-secret", DISCORD_GUILD_ID: guildId, SESSION_PASSWORD: password, SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", DISCORD_BOT_TOKEN: "" },
  });
  let logs = "";
  server.stdout.on("data", chunk => { logs += String(chunk); }); server.stderr.on("data", chunk => { logs += String(chunk); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (server.exitCode !== null) throw new Error(`Test server exited: ${logs}`);
      try { ready = (await fetch(`${origin}/api/auth/session`)).ok; } catch { /* startup */ }
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, logs);
    const request = (path: string, options?: RequestInit) => fetch(`${origin}${path}`, { ...options, redirect: "manual" });
    assert.deepEqual(await (await request("/api/auth/session")).json(), { configured: true, storageConfigured: false, registrationConfigured: false, user: null, guild: null });
    for (const path of ["/api/emoji/assets", "/api/emoji/assets/00000000-0000-4000-8000-000000000001/image"]) {
      const result = await request(path); assert.equal(result.status, 401); assert.match(result.headers.get("cache-control")!, /no-store/);
    }
    for (const [method, path] of [["POST", "/api/emoji/register"], ["POST", "/api/emoji/assets"], ["PATCH", "/api/emoji/assets/00000000-0000-4000-8000-000000000001"], ["DELETE", "/api/emoji/assets/00000000-0000-4000-8000-000000000001"], ["POST", "/api/auth/logout"]]) {
      assert.equal((await request(path, { method, headers: { Origin: "https://untrusted.example" } })).status, 403);
      if (path !== "/api/auth/logout") assert.equal((await request(path, { method, headers: { Origin: origin } })).status, 401);
    }
    const start = await request("/api/auth/discord?next=https://untrusted.example");
    assert.equal(start.status, 303);
    const authorize = new URL(start.headers.get("location")!);
    assert.equal(authorize.origin, "https://discord.com");
    assert.equal(authorize.searchParams.get("scope"), "identify guilds");
    assert.equal(authorize.searchParams.get("redirect_uri"), `${origin}/api/auth/discord/callback`);
    assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
    const setCookie = start.headers.get("set-cookie")!;
    assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=Lax/i);
    const cookie = setCookie.split(";")[0];
    const attempt = await unsealData<{ state: string; verifier: string }>(cookie.slice(cookie.indexOf("=") + 1), { password, ttl: 600 });
    assert.equal(attempt.state, authorize.searchParams.get("state"));
    assert.equal(createHash("sha256").update(attempt.verifier).digest("base64url"), authorize.searchParams.get("code_challenge"));
    for (const [query, error] of [
      ["state=wrong&iss=https://discord.com", "invalid_state"],
      [`state=${attempt.state}&iss=https://untrusted.example`, "invalid_state"],
      [`state=${attempt.state}&iss=https://discord.com&error=access_denied`, "cancelled"],
      [`state=${attempt.state}&iss=https://discord.com`, "oauth_failed"],
    ]) {
      const result = await request(`/api/auth/discord/callback?${query}`, { headers: { Cookie: cookie } });
      assert.equal(result.status, 303);
      const destination = new URL(result.headers.get("location")!);
      assert.equal(destination.origin, origin); assert.equal(destination.pathname, "/"); assert.equal(destination.searchParams.get("auth_error"), error);
      assert.match(result.headers.get("set-cookie")!, /Max-Age=0/);
    }
    const signedSession = async (changes: object) => `workshop=${await sealData({ token: "unused-test-token", user: { id: "323456789012345678", name: "test" }, guild: { id: guildId, name: "test guild", isAdmin: false }, expiresAt: Date.now() + 60_000, checkedAt: Date.now(), ...changes }, { password, ttl: 600 })}`;
    const expired = await request("/api/emoji/assets", { headers: { Cookie: await signedSession({ expiresAt: Date.now() - 1 }) } });
    assert.equal(expired.status, 401); assert.match(expired.headers.get("set-cookie")!, /Max-Age=0/);
    assert.equal((await request("/api/emoji/assets?guildId=invalid", { headers: { Cookie: await signedSession({}) } })).status, 400);
    assert.equal((await request("/api/emoji/assets", { headers: { Cookie: "workshop=tampered" } })).status, 401);
    // A valid cookie cached for A never authorizes B, even if the client claims B is an admin guild.
    const other = await request("/api/emoji/assets?guildId=999999999999999999", { headers:{Cookie:await signedSession({})} });
    assert.equal(other.status,403); assert.equal((await other.json()).code,"not_member");
    const missing = await request("/api/emoji/assets",{headers:{Cookie:await signedSession({})}});
    assert.equal(missing.status,400);
    const registration = await request(`/api/emoji/register?guildId=${guildId}`,{method:"POST",headers:{Origin:origin,Cookie:await signedSession({guild:{id:guildId,name:"cached admin",isAdmin:true,canCreateEmoji:true}})}});
    assert.equal(registration.status,403);assert.equal((await registration.json()).code,"emoji_forbidden");
    const stale = await request(`/api/emoji/assets?guildId=${guildId}`,{headers:{Cookie:await signedSession({token:"revoked",checkedAt:0})}});
    assert.equal(stale.status,401);
    // Valid signature/member reaches the storage guard, without manufacturing a successful save.
    const noStorage = await request(`/api/emoji/assets?guildId=${guildId}`, { headers: { Cookie: await signedSession({}) } });
    assert.equal(noStorage.status, 503); assert.equal((await noStorage.json()).code, "storage_not_configured");
    const logout = await request("/api/auth/logout", { method: "POST", headers: { Origin: origin } });
    assert.equal(logout.status, 200); assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/);
  } finally {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
});
