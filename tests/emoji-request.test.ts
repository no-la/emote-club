import assert from "node:assert/strict";
import { test } from "node:test";
import { workshopRequest, WorkshopRequestError } from "../src/lib/emoji/workshop-request";

test("stalled reads and mutations time out without retrying, and mutations warn of uncertain success", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  t.mock.method(globalThis, "fetch", (_url: unknown, options: RequestInit) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  });
  const read = assert.rejects(workshopRequest("/read"), (e: unknown) => e instanceof WorkshopRequestError && e.status === 408);
  t.mock.timers.tick(20_000); await read;
  const write = assert.rejects(workshopRequest("/write", { method: "POST" }), (e: unknown) => e instanceof WorkshopRequestError && e.status === 408 && e.message.includes("完了している可能性"));
  t.mock.timers.tick(60_000); await write;
  assert.equal(calls, 2);
});

test("timeout also covers response body; caller cancellation stays distinguishable", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => ({
    ok: true, json: () => new Promise((_resolve, reject) => options.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })),
  }));
  const pending = assert.rejects(workshopRequest("/slow-body"), (e: unknown) => e instanceof WorkshopRequestError && e.status === 408);
  await Promise.resolve(); t.mock.timers.tick(20_000); await pending;
  const caller = new AbortController();
  const cancelled = assert.rejects(workshopRequest("/cancel", { signal: caller.signal }), (e: unknown) => e instanceof DOMException && e.name === "AbortError");
  await Promise.resolve(); caller.abort(); await cancelled;
});

test("successful JSON and server error status are preserved", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ assets: [] }));
  assert.deepEqual(await workshopRequest("/assets"), { assets: [] });
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "denied" }, { status: 403 }));
  await assert.rejects(workshopRequest("/assets"), (e: unknown) => e instanceof WorkshopRequestError && e.status === 403 && e.message === "denied");
});


test("HTML proxy errors give an actionable message without exposing response bodies",async t=>{
  t.mock.method(globalThis,"fetch",async()=>new Response("<!DOCTYPE html>proxy error",{status:403}));
  await assert.rejects(workshopRequest("/assets"),(e:unknown)=>e instanceof WorkshopRequestError&&e.status===403&&!e.message.includes("DOCTYPE"));
});
