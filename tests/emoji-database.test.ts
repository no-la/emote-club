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


test("direct upload SQL isolates DB roles and reserves both objects with durable rate limits", async()=>{
  const db=new PGlite();
  try{
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
    for(const name of ["202610180001_emoji_assets.sql","202610180003_guild_quotas.sql","202610180004_direct_uploads.sql"]) await db.exec(await readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8"));
    const reserve=(n:number)=>db.query("select * from public.reserve_emoji_asset_upload($1,'123456789012345678','223456789012345678','owner','cat')",["00000000-0000-4000-8000-"+String(n).padStart(12,"0")]);
    for(const role of ["anon","authenticated"]){
      await db.exec("set role "+role);
      await assert.rejects(db.query("select * from public.emoji_asset_uploads"),/permission denied/);
      await assert.rejects(reserve(1),/permission denied/);
      await db.exec("reset role");
    }
    const bucket=(await db.query<{public:boolean;file_size_limit:number}>("select * from storage.buckets where id='emoji-upload-staging'")).rows[0];
    assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),4194304);
    await db.exec("set role service_role");
    for(let n=1;n<=3;n++)await reserve(n);
    await assert.rejects(reserve(4),/upload_throttled/);
    await db.exec("update public.emoji_asset_uploads set state='ready'");
    for(let n=4;n<=10;n++){await reserve(n);await db.exec("update public.emoji_asset_uploads set state='ready'");}
    await db.exec("delete from public.emoji_assets");
    await assert.rejects(reserve(11),/upload_throttled/);
    assert.equal((await db.query<{count:number}>("select count(*)::integer as count from public.emoji_asset_uploads")).rows[0].count,10);
    await db.exec("update public.emoji_asset_uploads set created_at=now()-interval '2 hours'");
    await db.query("insert into public.emoji_assets(id,guild_id,owner_id,owner_name,name,bytes,width,height) select ('00000000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,'123456789012345678','223456789012345678','owner','cat',4194304,1,1 from generate_series(1,21) n");
    await assert.rejects(reserve(12),/asset_quota_exceeded/);
    assert.equal((await db.query<{count:number}>("select count(*)::integer as count from public.emoji_asset_uploads")).rows[0].count,10);
  }finally{await db.close();}
});


test("registration staging is private, quota counted, and cancellation blocks delayed creates",async()=>{
  const db=new PGlite();
  try{
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
    for(const name of ["202610180001_emoji_assets.sql","202610180002_emoji_registrations.sql","202610180003_guild_quotas.sql","202610180004_direct_uploads.sql","202610180005_registration_uploads.sql"])await db.exec(await readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8"));
    const id="00000000-0000-4000-8000-000000000001";
    const upload=()=>db.query("select * from public.reserve_emoji_registration_upload($1,'123456789012345678','223456789012345678','test_emoji')",[id]);
    const cancel=()=>db.query<{status:string}>("select * from public.cancel_unstarted_emoji_registration($1,'123456789012345678','223456789012345678','test_emoji')",[id]);
    for(const role of ["anon","authenticated"]){await db.exec("set role "+role);await assert.rejects(upload(),/permission denied/);await assert.rejects(cancel(),/permission denied/);await db.exec("reset role");}
    await db.exec("set role service_role");
    await upload();
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from public.emoji_assets")).rows[0].count,0);
    assert.equal((await cancel()).rows[0].status,"failed");
    // Old request arriving after cancellation cannot acquire the registration reservation.
    await assert.rejects(db.query("select public.reserve_emoji_registration($1,'123456789012345678','223456789012345678','test_emoji',$2)",[id,"a".repeat(64)]),/request_conflict/);
    await db.exec("update public.emoji_registrations set status='pending'");
    assert.equal((await cancel()).rows[0].status,"pending"); // Never cancel a send that already started.
    await db.query("insert into public.emoji_assets(id,guild_id,owner_id,owner_name,name,bytes,width,height) select ('00000000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,'123456789012345678','223456789012345678','owner','cat',4194304,1,1 from generate_series(1,31) n");
    await assert.rejects(db.query("select public.reserve_emoji_registration_upload('00000000-0000-4000-8000-000000000002','123456789012345678','223456789012345678','cat')"),/asset_quota_exceeded/);
  }finally{await db.close();}
});
