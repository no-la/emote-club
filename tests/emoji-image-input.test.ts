import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { fitImage, inspectImage, validateImageDimensions, MAX_INPUT_IMAGE_BYTES } from "../src/lib/emoji/image-input";

test("PNG, JPEG, progressive JPEG and both WebP encodings expose bounded dimensions", async () => {
  for (const format of ["png", "jpeg", "progressive", "webp", "lossless"] as const) {
    const input = sharp({ create: { width: 83, height: 47, channels: 4, background: "#abcdef80" } });
    const bytes = await (format === "png" ? input.png() : format === "jpeg" ? input.jpeg() : format === "progressive" ? input.jpeg({ progressive: true }) : input.webp({ lossless: format === "lossless" })).toBuffer();
    assert.deepEqual(inspectImage(bytes), { width: 83, height: 47 }, format);
  }
});
test("large image limits and aspect ratio allow photos without unbounded allocation", () => {
  assert.equal(MAX_INPUT_IMAGE_BYTES, 20 * 1024 * 1024);
  assert.doesNotThrow(() => validateImageDimensions(8000, 6000));
  assert.throws(() => validateImageDimensions(8001, 6000), /4800/);
  assert.throws(() => validateImageDimensions(40000, 1), /32768/);
  assert.deepEqual(fitImage(6000, 4000), { width: 2048, height: 1365 });
  assert.deepEqual(fitImage(4000, 6000), { width: 1365, height: 2048 });
  assert.deepEqual(fitImage(128, 96), { width: 128, height: 96 });
  assert.deepEqual(fitImage(32768, 1), { width: 2048, height: 1 });
});
test("reject corrupt headers and animated inputs before browser decode", async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from("GIF89a"), Buffer.from([255,216,255,192,0,1])]) assert.throws(() => inspectImage(bytes));
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "transparent" } }).png().toBuffer();
  const apngChunk = Buffer.alloc(20); apngChunk.writeUInt32BE(8); apngChunk.write("acTL", 4);
  assert.throws(() => inspectImage(Buffer.concat([png.subarray(0, 33), apngChunk, png.subarray(33)])), /静止画像/);
  const oversized = Buffer.from(png); oversized.writeUInt32BE(8001,16); oversized.writeUInt32BE(6000,20);
  assert.throws(() => inspectImage(oversized), /4800/);
  assert.throws(() => inspectImage(png.subarray(0, 35)), /静止画像/);
  const animatedWebp = Buffer.alloc(30); animatedWebp.write("RIFF"); animatedWebp.writeUInt32LE(22,4); animatedWebp.write("WEBPVP8X",8); animatedWebp.writeUInt32LE(10,16); animatedWebp[20]=2;
  assert.throws(() => inspectImage(animatedWebp), /静止画像/);
});
