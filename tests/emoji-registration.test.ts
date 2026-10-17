import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import sharp from "sharp";
import { emojiName } from "../src/lib/emoji/registration";
import { guildEmojiCreator } from "../src/lib/emoji/shared";
import { normalizeEmoji, registerEmoji, registrationInput, registrationStatus, requireEmojiCreator } from "../src/lib/server/emoji-registration";
import { ApiError } from "../src/lib/server/http";

const originalEnv = { ...process.env };
afterEach(() => { mock.restoreAll(); process.env = { ...originalEnv }; });
const member = { user: { id: "323456789012345678", name: "member" }, guild: { id: "223456789012345678", name: "guild", isAdmin: false, canCreateEmoji: true } };
const requestId = "00000000-0000-4000-8000-000000000001";
const row = { request_id: requestId, guild_id: member.guild.id, user_id: member.user.id, name: "erai", fingerprint: "a".repeat(64), status: "pending", emoji_id: null, error_code: null, retry_at: null, created_at: new Date().toISOString() };
function configure() {
  Object.assign(process.env, { SITE_URL: "http://localhost:3000", DISCORD_CLIENT_ID: "123456789012345678", DISCORD_CLIENT_SECRET: "unused", DISCORD_GUILD_ID: member.guild.id, SESSION_PASSWORD: "test-password-".repeat(4), DISCORD_BOT_TOKEN: "test-only-bot", SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "test-only-key" });
}
const errorCode = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
async function png(size = 128) { return sharp({ create: { width: size, height: size, channels: 4, background: "transparent" } }).png().toBuffer(); }
async function input() { return { name: "erai", requestId, png: await png(), fingerprint: row.fingerprint }; }

test("creation permission is separate from membership and Manage Expressions", () => {
  assert.equal(guildEmojiCreator({ permissions: "0" }), false);
  assert.equal(guildEmojiCreator({ permissions: String(2 ** 30) }), false);
  assert.equal(guildEmojiCreator({ permissions: String(2 ** 43) }), true);
  assert.equal(guildEmojiCreator({ permissions: "8" }), true);
  assert.equal(guildEmojiCreator({ owner: true }), true);
  assert.equal(guildEmojiCreator({ permissions: "broken" }), false);
  assert.throws(() => requireEmojiCreator({ ...member, guild: { ...member.guild, canCreateEmoji: false } }), errorCode("emoji_forbidden"));
  for (const name of ["a", "日本語", "a b", "a".repeat(33), "@everyone", "ab\n"]) assert.equal(emojiName(name), null);
  assert.equal(emojiName("ok_123"), "ok_123");
});

test("registration validates actual PNG, dimensions, byte limit and strips metadata", async () => {
  const valid = await png();
  const normalized = await normalizeEmoji(valid);
  assert.equal((await sharp(normalized).metadata()).width, 128);
  await assert.rejects(normalizeEmoji(await png(129)), errorCode("invalid_emoji"));
  await assert.rejects(normalizeEmoji(await sharp(valid).jpeg().toBuffer()), errorCode("invalid_emoji"));
  await assert.rejects(normalizeEmoji(new Uint8Array(262145)), errorCode("emoji_too_large"));
  await assert.rejects(normalizeEmoji(valid.subarray(0, 40)), errorCode("invalid_emoji"));
  const apng = Buffer.concat([valid.subarray(0, 8), Buffer.from([0,0,0,0,97,99,84,76,0,0,0,0]), valid.subarray(8)]);
  await assert.rejects(normalizeEmoji(apng), errorCode("invalid_emoji"));
  const form = new FormData(); form.set("file", new File([valid], "x.png", { type: "image/png" })); form.set("name", "erai"); form.set("requestId", requestId); form.set("guildId", "999999999999999999");
  const parsed = await registrationInput(new Request("http://localhost/api/emoji/register", { method: "POST", body: form }));
  assert.equal(parsed.name, "erai"); assert.equal(parsed.fingerprint.length, 64); assert.equal("guildId" in parsed, false);
});

test("registration reserves once, uses server guild and Bot auth, and replays without Discord create", async () => {
  configure(); let saved = { ...row }; let first = true; let creates = 0;
  mock.method(globalThis, "fetch", async (url: RequestInfo | URL, options?: RequestInit) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("reserve_emoji_registration")) {
      const data = JSON.parse(String(options?.body)); assert.equal(data.guild, member.guild.id); assert.equal(data.actor, member.user.id);
      const claimed = first; first = false; return Response.json({ claimed, attempt: saved });
    }
    if (u.hostname === "discord.com") {
      assert.equal(u.pathname, `/api/v10/guilds/${member.guild.id}/emojis`);
      assert.equal(new Headers(options?.headers).get("authorization"), "Bot test-only-bot");
      if (options?.method !== "POST") return Response.json([]);
      creates++; const body = JSON.parse(String(options.body)); assert.equal(body.name, "erai"); assert.match(body.image, /^data:image\/png;base64,/); assert.deepEqual(body.roles, []);
      assert.match(new Headers(options.headers).get("x-audit-log-reason")!, /323456789012345678/);
      return Response.json({ id: "423456789012345678", name: "erai" }, { status: 201 });
    }
    assert.equal(options?.method, "PATCH"); saved = { ...saved, ...JSON.parse(String(options.body)) }; return Response.json(saved);
  });
  assert.equal((await registerEmoji(await input(), member)).status, "succeeded");
  assert.equal((await registerEmoji(await input(), member)).emojiId, "423456789012345678");
  assert.equal(creates, 1);
});

test("Discord failures distinguish quota, permission, rate limit and uncertain delivery", async () => {
  configure();
  for (const scenario of ["full", "permission", "rate", "timeout", "server", "duplicate", "save-failed"] as const) {
    let creates = 0;
    mock.method(globalThis, "fetch", async (url: RequestInfo | URL, options?: RequestInit) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("reserve_emoji_registration")) return Response.json({ claimed: true, attempt: row });
      if (u.hostname === "discord.com") {
        if (options?.method !== "POST") return Response.json(scenario === "duplicate" ? [{ name: "ERAI" }] : []);
        creates++;
        if (scenario === "timeout") throw new TypeError("network lost");
        if (scenario === "server") return Response.json({}, { status: 502 });
        if (scenario === "full") return Response.json({ code: 30008 }, { status: 400 });
        if (scenario === "permission") return Response.json({}, { status: 403 });
        if (scenario === "rate") return Response.json({ retry_after: 120.5 }, { status: 429 });
        return Response.json({ id: "423456789012345678", name: "erai" });
      }
      if (scenario === "save-failed") return Response.json({ message: "DB down" }, { status: 503 });
      return Response.json({ ...row, ...JSON.parse(String(options?.body)) });
    });
    const r = await registerEmoji(await input(), member);
    assert.equal(r.status, ["timeout", "server", "save-failed"].includes(scenario) ? "unknown" : "failed");
    assert.equal(creates, scenario === "duplicate" ? 0 : 1);
    if (scenario === "rate") assert.ok(r.retryAfter >= 120);
    mock.restoreAll();
  }
});

test("pending replay, reservation failure and revoked permission never create; status is owner scoped", async () => {
  configure(); let calls = 0;
  mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => { calls++; assert.ok(String(url).includes("reserve_emoji_registration")); return Response.json({ claimed: false, attempt: row }); });
  assert.equal((await registerEmoji(await input(), member)).status, "pending"); assert.equal(calls, 1);
  await assert.rejects(registerEmoji(await input(), { ...member, guild: { ...member.guild, canCreateEmoji: false } }), errorCode("emoji_forbidden")); assert.equal(calls, 1);
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => Response.json({ message: "registration_unresolved" }, { status: 400 }));
  await assert.rejects(registerEmoji(await input(), member), errorCode("registration_unresolved"));
  mock.restoreAll();
  mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => {
    const u = new URL(String(url)); assert.equal(u.searchParams.get("user_id"), `eq.${member.user.id}`); assert.equal(u.searchParams.get("guild_id"), `eq.${member.guild.id}`);
    return Response.json([{ ...row, created_at: new Date(Date.now() - 120000).toISOString() }]);
  });
  assert.equal((await registrationStatus(requestId, member)).status, "unknown");
});
