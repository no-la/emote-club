import "server-only";
import sharp from "sharp";
import { inspectImage } from "@/lib/emoji/image-input";
import { SHARED_IMAGE_BYTES } from "@/lib/emoji/shared";
import { ApiError } from "./http";

export async function normalizeSharedImage(input: Uint8Array) {
  if (!input.byteLength || input.byteLength > SHARED_IMAGE_BYTES) throw new ApiError(413, "too_large", "共有画像は4 MiB以下にしてください。");
  try {
    const header = Buffer.from(input.buffer, input.byteOffset, Math.min(input.byteLength, 12));
    const supported = header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || (header[0] === 255 && header[1] === 216 && header[2] === 255)
      || (header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP");
    if (!supported) throw new Error("unsupported image header");
    inspectImage(input); // Also reject APNG/animated WebP before the authoritative sharp decode.
    const image = sharp(input, { limitInputPixels: 16_000_000, animated: false, failOn: "warning" });
    const metadata = await image.metadata();
    if (!["png", "jpeg", "webp"].includes(metadata.format || "") || (metadata.pages ?? 1) > 1) throw new Error("unsupported image");
    const { data, info } = await image.timeout({ seconds: 5 }).rotate().webp({ lossless: true, effort: 3 }).toBuffer({ resolveWithObject: true });
    if (data.byteLength > SHARED_IMAGE_BYTES) throw new ApiError(413, "too_large", "変換後の画像が4 MiBを超えます。画像を小さくしてください。");
    return { data, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_image", "PNG・JPEG・WebPの静止画像を選んでください（1600万画素まで）。");
  }
}
