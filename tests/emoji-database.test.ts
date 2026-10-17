import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("migration enforces private access, asset validation, quota reservations and recovery accounting", async () => {
  const db = new PGlite();
  try {
    // Supabase supplies these roles/schema. The actual migration is executed unchanged.
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`);
    await db.exec(await readFile(new URL("../supabase/migrations/202610180001_emoji_assets.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/202610180003_guild_quotas.sql", import.meta.url), "utf8"));
    assert.equal((await db.query<{ public: boolean }>("select public from storage.buckets where id = 'emoji-assets'")).rows[0].public, false);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from public.emoji_assets"), /permission denied/);
      await assert.rejects(db.query("select * from public.reserve_emoji_asset('00000000-0000-4000-8000-000000000001', '123456789012345678', '223456789012345678', 'owner', 'asset', 100, 32, 32)"), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    const reserve = (id: number, bytes = 4194304) => db.query(`select * from public.reserve_emoji_asset($1, '123456789012345678', '223456789012345678', 'owner', 'asset', $2, 32, 32)`, [`00000000-0000-4000-8000-${String(id).padStart(12, "0")}`, bytes]);
    for (let id = 1; id <= 32; id++) await reserve(id);
    await assert.rejects(reserve(33, 1), /asset_quota_exceeded/);
    await db.query("select * from public.reserve_emoji_asset('00000000-0000-4000-8000-999999999999', '923456789012345678', '223456789012345678', 'owner', 'other guild', 1, 32, 32)");
    await db.exec("delete from public.emoji_assets where guild_id = '923456789012345678'");
    await db.exec("update public.emoji_assets set status = 'deleting'");
    await assert.rejects(reserve(34, 1), /asset_quota_exceeded/); // Interrupted deletes still consume quota.
    await db.exec("delete from public.emoji_assets where id = '00000000-0000-4000-8000-000000000001'");
    await reserve(35); // Only confirmed deletion releases capacity.
    await db.exec("delete from public.emoji_assets");
    for (let id = 1; id <= 500; id++) await reserve(id, 1);
    await assert.rejects(reserve(501, 1), /asset_quota_exceeded/);
    await db.exec("delete from public.emoji_assets");
    await assert.rejects(reserve(1, 4194305), /check constraint/);
    await assert.rejects(db.query("insert into public.emoji_assets (id,guild_id,owner_id,owner_name,name,bytes,width,height) values ('00000000-0000-4000-8000-000000000001','invalid','223456789012345678','owner','asset',1,32,32)"), /check constraint/);
  } finally { await db.close(); }
});


test("registration reservation is private, idempotent, serialized and retains uncertain sends", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    await db.exec(await readFile(new URL("../supabase/migrations/202610180002_emoji_registrations.sql", import.meta.url), "utf8"));
    const reserve = (id: number, name = "erai", digest = "a".repeat(64)) => db.query<{ reserve_emoji_registration: { claimed: boolean; retryAfter?: number } }>("select public.reserve_emoji_registration($1, '123456789012345678', '223456789012345678', $2, $3)", [`00000000-0000-4000-8000-${String(id).padStart(12, "0")}`, name, digest]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from public.emoji_registrations"), /permission denied/);
      await assert.rejects(reserve(1), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    assert.equal((await reserve(1)).rows[0].reserve_emoji_registration.claimed, true);
    assert.equal((await reserve(1)).rows[0].reserve_emoji_registration.claimed, false);
    await assert.rejects(reserve(1, "erai", "b".repeat(64)), /request_conflict/);
    await assert.rejects(reserve(2), /registration_unresolved/);
    await assert.rejects(reserve(2, "other"), /registration_busy/);
    await db.exec("update public.emoji_registrations set status='unknown'");
    await assert.rejects(reserve(2), /registration_unresolved/);
    await db.exec("update public.emoji_registrations set status='failed', retry_at=now()+interval '120 seconds'");
    assert.ok((await reserve(2)).rows[0].reserve_emoji_registration.retryAfter! >= 119);
    await db.exec("update public.emoji_registrations set retry_at=null");
    for (let id = 2; id <= 5; id++) {
      assert.equal((await reserve(id)).rows[0].reserve_emoji_registration.claimed, true);
      await db.exec("update public.emoji_registrations set status='failed'");
    }
    await assert.rejects(reserve(6), /registration_throttled/);
  } finally { await db.close(); }
});
