import assert from "node:assert/strict";
import { afterEach, test, mock } from "node:test";
import sharp from "sharp";
import { getIronSession } from "iron-session";
import { assetName, canManageAsset, guildAdministrator, SHARED_IMAGE_BYTES } from "../src/lib/emoji/shared";
import { normalizeSharedImage } from "../src/lib/server/shared-image";
import { ApiError, limitedBody } from "../src/lib/server/http";
import { authConfig, requireSameOrigin } from "../src/lib/server/workshop-config";
import { discordGuild, discordGuilds, exchangeDiscordCode } from "../src/lib/server/discord";

const originalEnv = { ...process.env };
afterEach(() => { mock.restoreAll(); process.env = { ...originalEnv }; });
function configure() {
  Object.assign(process.env, { SITE_URL: "http://localhost:3000", DISCORD_CLIENT_ID: "123456789012345678", DISCORD_CLIENT_SECRET: "test-secret", DISCORD_GUILD_ID: "223456789012345678", SESSION_PASSWORD: "test-only-password-at-least-32-characters" });
}
function errorCode(code: string) { return (error: unknown) => error instanceof ApiError && error.code === code; }

test("asset names reject empty/control/oversized values, and permissions are owner or Administrator only", () => {
  assert.equal(assetName("  ねこ  "), "ねこ");
  for (const value of [null, "  ", "x".repeat(81), "a\nb", "a\0b"]) assert.equal(assetName(value), null);
  assert.equal(assetName("猫".repeat(80))?.length, 80);
  assert.equal(canManageAsset("owner", "owner", false), true);
  assert.equal(canManageAsset("owner", "other", false), false);
  assert.equal(canManageAsset("owner", "other", true), true);
  assert.equal(guildAdministrator({ permissions: "32" }), false); // Manage Guild is not Administrator.
  assert.equal(guildAdministrator({ permissions: "8" }), true);
  assert.equal(guildAdministrator({ owner: true }), true);
  assert.equal(guildAdministrator({ permissions: "invalid" }), false);
});

test("production requires HTTPS, explicit Discord settings, and same-origin writes", () => {
  configure(); assert.ok(authConfig());
  assert.doesNotThrow(() => requireSameOrigin(new Request("http://localhost:3000/api/emoji/assets", { headers: { Origin: "http://localhost:3000" } })));
  assert.doesNotThrow(() => requireSameOrigin(new Request("http://internal:3000/api/emoji/assets", { headers: { Host: "localhost:3000", Origin: "http://localhost:3000" } })));
  assert.throws(() => requireSameOrigin(new Request("http://localhost:3000/api/emoji/assets", { headers: { Host: "untrusted.example", Origin: "http://localhost:3000" } })), errorCode("invalid_origin"));
  for (const origin of ["https://elsewhere.example", "null", ""]) assert.throws(() => requireSameOrigin(new Request("http://localhost:3000/api/emoji/assets", { headers: { Origin: origin } })), errorCode("invalid_origin"));
  process.env.SITE_URL = "http://public.example"; assert.equal(authConfig(), null);
  process.env.SITE_URL = "https://public.example"; assert.equal(authConfig()?.secure, true);
  process.env.SESSION_PASSWORD = "short"; assert.equal(authConfig(), null);
});

test("forwarded host is opt-in and requires a single exact public host with a valid Origin", () => {
  configure();
  const request = (host: string | null, origin = "http://localhost:3000") => new Request("http://internal:3000/api/emoji/assets", {
    headers: { Host: "internal:3000", Origin: origin, ...(host === null ? {} : { "X-Forwarded-Host": host }) },
  });
  delete process.env.TRUST_PROXY_HOST;
  assert.throws(() => requireSameOrigin(request("localhost:3000")), errorCode("invalid_origin"));
  process.env.TRUST_PROXY_HOST = "1";
  assert.doesNotThrow(() => requireSameOrigin(request("localhost:3000")));
  for (const host of [null, "untrusted.example", "localhost:3000, untrusted.example", "untrusted.example, localhost:3000"]) {
    assert.throws(() => requireSameOrigin(request(host)), errorCode("invalid_origin"));
  }
  for (const origin of ["https://untrusted.example", "null", ""]) {
    assert.throws(() => requireSameOrigin(request("localhost:3000", origin)), errorCode("invalid_origin"));
  }
});

test("session cookie is encrypted, HttpOnly, Secure and cannot be forged", async () => {
  const values = new Map<string, string>();
  const writes: { name: string; options: unknown }[] = [];
  const options = { cookieName: "__Host-workshop", password: "test-only-password-at-least-32-characters", ttl: 600, cookieOptions: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" } };
  const jar = { get: (name: string) => ({ name, value: values.get(name) || "" }), set: (name: string, value: string, opts: unknown) => { values.set(name, value); writes.push({ name, options: opts }); } };
  const session = await getIronSession<{ token: string; userId: string }>(jar, options);
  session.token = "private-provider-token"; session.userId = "123456789012345678"; await session.save();
  const cookie = values.get(options.cookieName)!;
  assert.ok(!cookie.includes("private-provider-token"));
  assert.equal((await getIronSession<{ token: string }>(jar, options)).token, "private-provider-token");
  assert.deepEqual(writes[0].options, { ...options.cookieOptions, maxAge: 540 });
  values.set(options.cookieName, `${cookie.slice(0, -10)}tampered!!`);
  assert.equal((await getIronSession<{ token: string }>(jar, options)).token, undefined);
  session.destroy(); assert.equal(values.get(options.cookieName), "");
});

test("image validation decodes bytes, preserves alpha and strips metadata", async () => {
  const png = await sharp({ create: { width: 32, height: 24, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().withMetadata().toBuffer();
  const image = await normalizeSharedImage(png);
  assert.equal(image.width, 32); assert.equal(image.height, 24);
  const decoded = await sharp(image.data).metadata();
  assert.equal(decoded.format, "webp"); assert.equal(decoded.hasAlpha, true); assert.equal(decoded.exif, undefined);
  assert.equal((await normalizeSharedImage(image.data)).width, 32);
  const oriented = await sharp({ create: { width: 32, height: 24, channels: 3, background: "white" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const rotated = await normalizeSharedImage(oriented);
  assert.equal(rotated.width, 24); assert.equal(rotated.height, 32);
  await assert.rejects(normalizeSharedImage(Buffer.from("pretending to be image/png")), errorCode("invalid_image"));
  await assert.rejects(normalizeSharedImage(Buffer.alloc(SHARED_IMAGE_BYTES + 1)), errorCode("too_large"));
  const large = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(normalizeSharedImage(large), errorCode("invalid_image"));
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  await assert.rejects(normalizeSharedImage(svg), errorCode("invalid_image"));
});

test("stream limit cannot be bypassed with absent or false content-length", async () => {
  const request = new Request("http://localhost/api", { method: "POST", body: "123456789" });
  await assert.rejects(limitedBody(request, 5), errorCode("too_large"));
  const lying = new Request("http://localhost/api", { method: "POST", headers: { "Content-Length": "1" }, body: "123456789" });
  await assert.rejects(limitedBody(lying, 5), errorCode("too_large"));
  assert.equal((await limitedBody(new Request("http://localhost/api", { method: "POST", body: "123" }), 5)).toString(), "123");
});

test("membership is checked for the requested guild and handles revoked/limited tokens", async () => {
  configure();
  mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(String(url), "https://discord.com/api/v10/users/@me/guilds?limit=200");
    assert.deepEqual(options?.headers, { Authorization: "Bearer provider-token" });
    return Response.json([{ id: "223456789012345678", name: "開発サーバー", permissions: "8" }]);
  });
  assert.deepEqual(await discordGuild("provider-token", "223456789012345678"), { id: "223456789012345678", name: "開発サーバー", isAdmin: true, canManageGuild: true, canCreateEmoji: true });
  mock.restoreAll(); mock.method(globalThis, "fetch", async () => Response.json([{ id: "other", name: "other" }]));
  await assert.rejects(discordGuild("token", "223456789012345678"), errorCode("not_member"));
  mock.restoreAll(); mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
  await assert.rejects(discordGuild("token", "223456789012345678"), errorCode("session_expired"));
  mock.restoreAll(); mock.method(globalThis, "fetch", async () => new Response(null, { status: 429 }));
  await assert.rejects(discordGuild("token", "223456789012345678"), errorCode("discord_unavailable"));
});

test("OAuth exchange includes PKCE and rejects missing scopes", async () => {
  configure();
  mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
    const body = options?.body as URLSearchParams;
    assert.equal(body.get("code_verifier"), "test-verifier");
    assert.equal(body.get("redirect_uri"), "http://localhost:3000/api/auth/discord/callback");
    return Response.json({ access_token: "token", expires_in: 604800, token_type: "Bearer", scope: "identify" });
  });
  await assert.rejects(exchangeDiscordCode("code", "test-verifier"), errorCode("oauth_failed"));
});

test("server selection follows paginated memberships and never trusts another guild's permissions", async () => {
  configure();
  const first = Array.from({length:200},(_,i)=>({id:String(BigInt("100000000000000000")+BigInt(i)),name:"other",permissions:"8"}));
  const target = {id:"223456789012345678",name:"target",permissions:"0"};
  const paths:string[]=[];
  mock.method(globalThis,"fetch",async (input: RequestInfo|URL)=> {
    const url=new URL(String(input));paths.push(url.search);
    return Response.json(url.searchParams.has("after") ? [target] : first);
  });
  const member=await discordGuild("token",target.id);
  assert.equal(member.isAdmin,false);assert.equal(member.canCreateEmoji,false);
  assert.equal(paths.length,2);assert.match(paths[1],/after=100000000000000199/);
  await assert.rejects(discordGuild("token","999999999999999999"),errorCode("not_member"));
  assert.equal((await discordGuilds("token")).length,201);
});
