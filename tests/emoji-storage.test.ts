import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import sharp from "sharp";
import { ApiError } from "../src/lib/server/http";
import { signedAssets, assetStore, findAsset, requireAssetManager, uploadAsset } from "../src/lib/server/shared-assets";

const originalEnv = { ...process.env };
afterEach(() => { mock.restoreAll(); process.env = { ...originalEnv }; });
const member = { user: { id: "323456789012345678", name: "member" }, guild: { id: "223456789012345678", name: "guild", isAdmin: false } };
function configure() { process.env.SUPABASE_URL = "http://127.0.0.1:54321"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-server-key"; }
async function uploadRequest() {
  const data = await sharp({ create: { width: 8, height: 8, channels: 4, background: "transparent" } }).png().toBuffer();
  const form = new FormData(); form.set("file", new File([data], "cat.png", { type: "image/png" })); form.set("name", "ねこ");
  form.set("guild", "999999999999999999"); form.set("owner", "999999999999999999"); // Untrusted fields must be ignored.
  return new Request("http://localhost/api/emoji/assets", { method: "POST", body: form });
}
const row = { id: "00000000-0000-4000-8000-000000000001", guild_id: member.guild.id, owner_id: member.user.id, owner_name: member.user.name, name: "ねこ", bytes: 100, width: 8, height: 8, status: "pending" as const, created_at: new Date().toISOString() };

test("shared upload reserves authenticated owner/guild, uploads private WebP, then publishes", async () => {
  configure();
  const sequence: string[] = [];
  let id = "";
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(String(input)); sequence.push(`${options?.method || "GET"} ${url.pathname}`);
    if (url.pathname.endsWith("/rpc/reserve_emoji_asset")) {
      const body = JSON.parse(String(options?.body)); id = body.asset_id;
      assert.equal(body.guild, member.guild.id); assert.equal(body.actor, member.user.id);
      assert.equal(body.actor_name, member.user.name); assert.equal(body.asset_name, "ねこ");
      return Response.json({ ...row, id, bytes: body.asset_bytes });
    }
    if (url.pathname.startsWith("/storage/v1/object/emoji-assets/")) {
      assert.equal(url.pathname, `/storage/v1/object/emoji-assets/${member.guild.id}/${id}.webp`);
      assert.equal(new Headers(options?.headers).get("content-type"), "image/webp");
      return Response.json({ Key: `emoji-assets/${member.guild.id}/${id}.webp` });
    }
    if (url.pathname === "/storage/v1/object/sign/emoji-assets") {
      assert.deepEqual(JSON.parse(String(options?.body)), {expiresIn:300, paths:[`${member.guild.id}/${id}.webp`]});
      return Response.json([{path:`${member.guild.id}/${id}.webp`,signedURL:`/object/sign/emoji-assets/${member.guild.id}/${id}.webp?token=test`}]);
    }
    assert.equal(options?.method, "PATCH"); assert.equal(url.searchParams.get("guild_id"), `eq.${member.guild.id}`);
    assert.equal(url.searchParams.get("status"), "eq.pending");
    return Response.json({ ...row, id, status: "ready" });
  });
  const result = await uploadAsset(await uploadRequest(), member);
  assert.equal(result.ownerId, member.user.id); assert.equal(result.status, "ready"); assert.equal(result.canManage, true);
  assert.equal(sequence.length, 4); assert.match(result.imageUrl!, /token=test/); assert.match(sequence[0], /reserve_emoji_asset/); assert.match(sequence[1], /storage/); assert.match(sequence[2], /^PATCH/);
});

test("quota refusal never uploads a file", async () => {
  configure(); let calls = 0;
  mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ message: "asset_quota_exceeded", code: "P0001" }, { status: 400 }); });
  await assert.rejects(uploadAsset(await uploadRequest(), member), (error: unknown) => error instanceof ApiError && error.code === "quota_exceeded");
  assert.equal(calls, 1);
});

test("failed uploads remove storage before releasing quota, while failed cleanup keeps reservation", async () => {
  configure();
  for (const cleanupFails of [false, true]) {
    const sequence: string[] = [];
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = new URL(String(input)); sequence.push(`${options?.method || "GET"} ${url.pathname}`);
      if (url.pathname.endsWith("/reserve_emoji_asset")) return Response.json(row);
      if (options?.method === "POST") return Response.json({ message: "Upload failed" }, { status: 400 });
      if (url.pathname.startsWith("/storage/")) return cleanupFails ? Response.json({ message: "Cleanup failed" }, { status: 400 }) : Response.json([]);
      assert.equal(options?.method, "DELETE"); return new Response(null, { status: 204 });
    });
    await assert.rejects(uploadAsset(await uploadRequest(), member));
    assert.match(sequence[2], /^DELETE \/storage/);
    assert.equal(sequence.length, cleanupFails ? 3 : 4);
    if (!cleanupFails) assert.match(sequence[3], /^DELETE \/rest/);
    mock.restoreAll();
  }
});

test("asset lookup scopes UUIDs to server; owners/admins alone may mutate", async () => {
  configure();
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("guild_id"), `eq.${member.guild.id}`);
    assert.equal(url.searchParams.get("id"), `eq.${row.id}`);
    return Response.json([]);
  });
  await assert.rejects(findAsset(assetStore(), row.id, member), (error: unknown) => error instanceof ApiError && error.status === 404);
  assert.doesNotThrow(() => requireAssetManager(row, member));
  const other = { ...member, user: { ...member.user, id: "423456789012345678" } };
  assert.throws(() => requireAssetManager(row, other), (error: unknown) => error instanceof ApiError && error.status === 403);
  assert.doesNotThrow(() => requireAssetManager(row, { ...other, guild: { ...other.guild, isAdmin: true } }));
});

test("signed URLs are batched and cannot include another guild's assets", async () => {
  configure(); let calls=0;
  mock.method(globalThis,"fetch",async (_input:RequestInfo|URL, options?:RequestInit)=> {
    calls++;
    const body=JSON.parse(String(options?.body));assert.equal(body.expiresIn,300);assert.equal(body.paths.length,2);
    return Response.json(body.paths.map((path:string)=>({path,signedURL:`/object/sign/emoji-assets/${path}?token=test`})));
  });
  const second={...row,id:"00000000-0000-4000-8000-000000000002",status:"ready" as const};
  const data=await signedAssets(assetStore(),[{...row,status:"ready"},second],member);
  assert.equal(calls,1);assert.equal(data.length,2);assert.ok(data.every(a=>a.imageUrl?.includes("token=test")));
  await assert.rejects(signedAssets(assetStore(),[{...row,guild_id:"999999999999999999"}],member), (e:unknown)=>e instanceof ApiError&&e.status===403);
  assert.equal(calls,1);
});
