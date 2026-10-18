import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { discordGuilds, discordRequest } from "../src/lib/server/discord";
import { api, ApiError } from "../src/lib/server/http";
afterEach(() => mock.restoreAll());

test("overlapping membership checks share only the same token and never cache completed permissions", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  mock.method(globalThis, "fetch", async () => { calls++; await gate; return Response.json([]); });
  const a = discordGuilds("a"), b = discordGuilds("a"), c = discordGuilds("b");
  assert.equal(calls, 2);
  release(); await Promise.all([a,b,c]);
  await discordGuilds("a"); assert.equal(calls, 3);
});

test("failed shared checks are released and rate limit wait is surfaced without provider body", async () => {
  mock.method(globalThis, "fetch", async () => Response.json({ retry_after: 12.4, secret: "never expose" }, { status: 429, headers: { "Retry-After": "10" } }));
  const response = await api(async () => { await discordGuilds("limited"); return Response.json({}); });
  assert.equal(response.status, 429); assert.equal(response.headers.get("Retry-After"), "13");
  const body = await response.json(); assert.equal(body.code, "discord_rate_limited"); assert.equal(body.retryAfter, 13);
  assert.ok(!JSON.stringify(body).includes("never expose"));
  mock.restoreAll(); mock.method(globalThis, "fetch", async () => Response.json([]));
  assert.deepEqual(await discordGuilds("limited"), []);
});

test("upstream failures include only status, while invalid sessions remain distinct", async () => {
  mock.method(globalThis, "fetch", async () => new Response("private upstream body", { status: 403 }));
  await assert.rejects(discordRequest("/users/@me/guilds", "x"), e => e instanceof ApiError && e.code === "discord_unavailable" && e.message.includes("403") && !e.message.includes("private"));
  mock.restoreAll(); mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
  await assert.rejects(discordGuilds("x"), e => e instanceof ApiError && e.code === "session_expired");
});
