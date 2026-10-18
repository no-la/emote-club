
import assert from "node:assert/strict";
import {afterEach,mock,test} from "node:test";
import sharp from "sharp";
import {beginRegistrationUpload,completeRegistrationUpload} from "../src/lib/server/registration-upload";
import {ApiError} from "../src/lib/server/http";
const env={...process.env};
afterEach(()=>{mock.restoreAll();process.env={...env};});
const id="00000000-0000-4000-8000-000000000001";
const member={user:{id:"323456789012345678",name:"owner"},guild:{id:"223456789012345678",name:"guild",isAdmin:false,canCreateEmoji:true}};
const request=(body:object)=>new Request("http://localhost/api",{method:"POST",body:JSON.stringify(body)});
const upload={id,guild_id:member.guild.id,owner_id:member.user.id,purpose:"registration",registration_name:"test_emoji",state:"pending",created_at:new Date().toISOString()};
const attempt={request_id:id,guild_id:member.guild.id,user_id:member.user.id,name:"test_emoji",fingerprint:"a".repeat(64),status:"succeeded",emoji_id:"423456789012345678",created_at:new Date().toISOString()};
function configure(){process.env.SUPABASE_URL="http://127.0.0.1:54321";process.env.SUPABASE_SERVICE_ROLE_KEY="test-only-key";process.env.DISCORD_BOT_TOKEN="test-bot";process.env.DISCORD_CLIENT_ID="123456789012345678";process.env.DISCORD_CLIENT_SECRET="test-secret";process.env.SESSION_PASSWORD="test-password-at-least-32-characters";process.env.SITE_URL="http://localhost:3000";}
const code=(name:string)=>(e:unknown)=>e instanceof ApiError&&e.code===name;

test("non-creators cannot issue or finalize registration uploads",async()=>{
  const denied={...member,guild:{...member.guild,canCreateEmoji:false}};
  mock.method(globalThis,"fetch",()=>{throw Error("must not fetch");});
  await assert.rejects(beginRegistrationUpload(request({name:"cat"}),denied),code("emoji_forbidden"));
  await assert.rejects(completeRegistrationUpload(request({requestId:id}),denied),code("emoji_forbidden"));
});

test("registration reservation uses verified identity and cannot expose a service key",async()=>{
  configure();
  mock.method(globalThis,"fetch",async(input:RequestInfo|URL,options?:RequestInit)=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith("emoji_asset_uploads"))return Response.json([]);
    if(url.pathname.endsWith("reserve_emoji_registration_upload")) {
      const body=JSON.parse(String(options?.body));assert.equal(body.guild,member.guild.id);assert.equal(body.actor,member.user.id);assert.equal(body.emoji_name,"cat");return Response.json(upload);
    }
    assert.ok(url.pathname.includes("/upload/sign/emoji-upload-staging/"));
    assert.notEqual(new Headers(options?.headers).get("x-upsert"),"true");
    return Response.json({url:"/object/upload/sign/emoji-upload-staging/"+member.guild.id+"/"+id+"?token=scoped"});
  });
  const result=await beginRegistrationUpload(request({name:"cat",owner:"other",guild:"other"}),member);
  assert.deepEqual(Object.keys(result),["id","uploadUrl"]);assert.ok(!JSON.stringify(result).includes("test-only-key"));
});

test("completion scopes owner, guild, purpose; validates 128px PNG and replays without touching Discord",async()=>{
  configure();
  const png=await sharp({create:{width:128,height:128,channels:4,background:"transparent"}}).png().toBuffer();
  for(const valid of [false,true]){
    let stored=false;let downloads=0;let reserves=0;
    mock.method(globalThis,"fetch",async(input:RequestInfo|URL,options?:RequestInit)=>{
      const url=new URL(String(input));assert.notEqual(url.host,"discord.com");
      if(url.pathname.endsWith("emoji_registrations"))return Response.json(stored?attempt:null);
      if(url.pathname.endsWith("emoji_asset_uploads")){
        if(options?.method!=="PATCH"){
          assert.equal(url.searchParams.get("owner_id"),"eq."+member.user.id);
          assert.equal(url.searchParams.get("guild_id"),"eq."+member.guild.id);
          assert.equal(url.searchParams.get("purpose"),"eq.registration");
        }
        return Response.json(options?.method==="PATCH"?{id}:upload);
      }
      if(url.pathname.includes("/storage/")){downloads++;return new Response(valid?new Uint8Array(png):"not a PNG");}
      assert.ok(url.pathname.endsWith("reserve_emoji_registration"));reserves++;
      const body=JSON.parse(String(options?.body));assert.equal(body.emoji_name,"test_emoji");assert.equal(body.request,id);assert.match(body.digest,/^[0-9a-f]{64}$/);
      stored=true;return Response.json({claimed:false,attempt});
    });
    if(valid){assert.equal((await completeRegistrationUpload(request({requestId:id,name:"untrusted"}),member)).status,"succeeded");await completeRegistrationUpload(request({requestId:id}),member);assert.equal(reserves,1);}
    else{await assert.rejects(completeRegistrationUpload(request({requestId:id}),member),code("invalid_emoji"));assert.equal(reserves,0);}
    assert.equal(downloads,1);mock.restoreAll();
  }
});

test("another owner's upload and an already claimed upload never reach decode or Discord",async()=>{
  configure();
  for(const found of [false,true]){
    mock.method(globalThis,"fetch",async(input:RequestInfo|URL,options?:RequestInit)=>{
      const url=new URL(String(input));assert.ok(!url.pathname.includes("/storage/"));assert.notEqual(url.host,"discord.com");
      if(url.pathname.endsWith("emoji_registrations"))return Response.json(null);
      if(options?.method==="PATCH")return Response.json(null);
      return Response.json(found?upload:null);
    });
    await assert.rejects(completeRegistrationUpload(request({requestId:id}),member),code(found?"upload_busy":"upload_not_found"));mock.restoreAll();
  }
});
