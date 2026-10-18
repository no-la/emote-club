
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import sharp from "sharp";
import { beginAssetUpload, completeAssetUpload, cleanupAssetUploads } from "../src/lib/server/direct-asset-upload";
import { reserveAssetUpload, sendAssetUpload } from "../src/lib/emoji/direct-upload";
import { ApiError } from "../src/lib/server/http";
const env = { ...process.env };
afterEach(() => { mock.restoreAll(); process.env = { ...env }; });
const member = { user: { id: "323456789012345678", name: "owner" }, guild: { id: "223456789012345678", name: "guild", isAdmin: false } };
const id = "00000000-0000-4000-8000-000000000001";
const upload = { id, guild_id: member.guild.id, owner_id: member.user.id, state: "pending", created_at: new Date().toISOString(), expires_at: new Date(Date.now()+10800000).toISOString() };
const asset = { ...upload, owner_name: "owner", name: "cat", status: "pending", bytes: 4194304, width: 1, height: 1 };
function configure() { process.env.SUPABASE_URL = "http://127.0.0.1:54321"; process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-test-key"; }
const code = (expected: string) => (e: unknown) => e instanceof ApiError && e.code === expected;

test("reservation ignores client ownership/path and signs only private immutable staging", async () => {
  configure(); let calls = 0;
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(String(input)); calls++;
    if (url.pathname.endsWith("reserve_emoji_asset_upload")) {
      const body = JSON.parse(String(options?.body));
      assert.equal(body.guild, member.guild.id); assert.equal(body.actor, member.user.id);
      assert.equal(body.asset_name, "cat"); assert.equal(body.asset_bytes, undefined);
      return Response.json(upload);
    }
    assert.equal(url.pathname, "/storage/v1/object/upload/sign/emoji-upload-staging/"+member.guild.id+"/"+id);
    assert.notEqual(new Headers(options?.headers).get("x-upsert"), "true");
    return Response.json({ url: "/object/upload/sign/emoji-upload-staging/"+member.guild.id+"/"+id+"?token=scoped" });
  });
  const result = await beginAssetUpload(new Request("http://localhost/api", {method:"POST", body:JSON.stringify({name:"cat", owner:"other", path:"other", bytes:1})}), member);
  assert.equal(calls,2); assert.deepEqual(Object.keys(result),["id","uploadUrl"]);
  assert.ok(!JSON.stringify(result).includes("server-only-test-key"));
});

test("foreign owner/guild cannot finalize even as admin; failed claim never decodes", async () => {
  configure();
  for (const found of [false,true]) {
    let downloads = 0;
    mock.method(globalThis,"fetch",async(input:RequestInfo|URL, options?:RequestInit)=>{
      const url=new URL(String(input));
      if(url.pathname.includes("storage")) downloads++;
      if(url.pathname.endsWith("emoji_asset_uploads")) {
        assert.equal(url.searchParams.get("owner_id"),"eq."+member.user.id);
        assert.equal(url.searchParams.get("guild_id"),"eq."+member.guild.id);
        return Response.json(options?.method==="PATCH" || !found ? null : upload);
      }
      return Response.json(asset);
    });
    await assert.rejects(completeAssetUpload(id,{...member,guild:{...member.guild,isAdmin:true}}),code(found?"upload_busy":"upload_not_found"));
    assert.equal(downloads,0);mock.restoreAll();
  }
});

test("finalize validates bytes, publishes normalized output, and repeated completion is read-only", async () => {
  configure();
  const png = await sharp({create:{width:20,height:10,channels:4,background:"transparent"}}).png().toBuffer();
  for(const valid of [false,true]) {
    let ready=false;let decoded=0;let output=0;
    mock.method(globalThis,"fetch",async(input:RequestInfo|URL, options?:RequestInit)=>{
      const url=new URL(String(input));
      if(url.pathname.endsWith("emoji_asset_uploads")) return Response.json(options?.method==="PATCH"?{id}:upload);
      if(url.pathname.endsWith("emoji_assets")) {
        if(options?.method==="PATCH") {
          const change=JSON.parse(String(options.body));assert.equal(change.width,20);assert.equal(change.height,10);assert.ok(change.bytes<4194304);ready=true;
        }
        return Response.json({...asset,status:ready?"ready":"pending"});
      }
      if(url.pathname.includes("emoji-upload-staging")){decoded++;return new Response(valid?new Uint8Array(png):"not an image");}
      if(url.pathname.includes("/object/sign/")) return Response.json([{path:member.guild.id+"/"+id+".webp",signedURL:"/object/sign/emoji-assets/test?token=read"}]);
      assert.ok(valid);output++;assert.equal(new Headers(options?.headers).get("content-type"),"image/webp");return Response.json({Key:"saved"});
    });
    if(valid){assert.equal((await completeAssetUpload(id,member)).status,"ready");await completeAssetUpload(id,member);assert.equal(output,1);}
    else {await assert.rejects(completeAssetUpload(id,member),code("invalid_image"));assert.equal(ready,false);assert.equal(output,0);}
    assert.equal(decoded,1);mock.restoreAll();
  }
});

test("cleanup retains quota on failed deletion and never removes ready output", async()=>{
  configure();
  for(const failed of [true,false]){
    const paths:string[]=[];
    mock.method(globalThis,"fetch",async(input:RequestInfo|URL,options?:RequestInit)=>{
      const url=new URL(String(input));paths.push((options?.method||"GET")+" "+url.pathname);
      if(url.pathname.endsWith("emoji_asset_uploads") && options?.method!=="DELETE") {
        assert.ok(url.searchParams.has("expires_at"));return Response.json([upload]);
      }
      if(url.pathname.includes("storage")){assert.ok(url.pathname.endsWith("emoji-upload-staging"));return failed?Response.json({message:"failed"},{status:400}):Response.json([]);}
      if(url.pathname.endsWith("emoji_assets"))return Response.json({status:"ready"});
      return new Response(null,{status:204});
    });
    await cleanupAssetUploads();
    assert.equal(paths.some(p=>p==="DELETE /rest/v1/emoji_asset_uploads"),!failed);
    mock.restoreAll();
  }
});

test("browser sends image only to signed Storage without credentials and reuses upload on finalize retry",async()=>{
  let imageCalls=0;let completeCalls=0;
  mock.method(globalThis,"fetch",async(input:string,options?:RequestInit)=>{
    if(input.startsWith("https://storage.example/")) {imageCalls++;assert.equal(options?.credentials,"omit");assert.equal(options?.referrerPolicy,"no-referrer");assert.equal(new Headers(options?.headers).get("authorization"),null);assert.equal(options?.method,"PUT");return Response.json({});}
    if(input.includes("/complete")){completeCalls++;return Response.json({asset:{...asset,status:"ready"}});}
    assert.ok(typeof options?.body==="string" && options.body.length<2048);return Response.json({id,uploadUrl:"https://storage.example/upload?token=test"});
  });
  const ticket=await reserveAssetUpload("cat",member.guild.id);
  const file=new File([new Uint8Array(123168)],"test.webp",{type:"image/webp"});
  await sendAssetUpload(ticket,file,member.guild.id);await sendAssetUpload(ticket,file,member.guild.id);
  assert.equal(imageCalls,1);assert.equal(completeCalls,2);
});
