import assert from "node:assert/strict";
import { test } from "node:test";
import { discordBotInstalled } from "../src/lib/server/discord-bot";

test("Bot presence distinguishes absent guilds from API failures", async () => {
  const originalFetch = globalThis.fetch;
  const token = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = "test-only-bot";
  const guild = "223456789012345678";
  try {
    for (const [status, body, expected] of [
      [200, { id: guild }, true], [404, { code: 10004 }, false], [403, { code: 50001 }, false],
      [401, { code: 0 }, null], [429, { retry_after: 1 }, null], [500, {}, null],
      [403, { code: 50013 }, null], [200, { id: "other" }, null],
    ] as const) {
      globalThis.fetch = async (url, options) => {
        assert.equal(String(url), `https://discord.com/api/v10/guilds/${guild}`);
        assert.equal(new Headers(options?.headers).get("Authorization"), "Bot test-only-bot");
        return Response.json(body, { status });
      };
      if (expected === null) await assert.rejects(discordBotInstalled(guild), { code: "bot_status_unavailable" });
      else assert.equal(await discordBotInstalled(guild), expected);
    }
    delete process.env.DISCORD_BOT_TOKEN;
    await assert.rejects(discordBotInstalled(guild), { code: "bot_not_configured" });
  } finally {
    globalThis.fetch = originalFetch;
    if (token === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = token;
  }
});
