import { fitImage, inspectImage, MAX_INPUT_IMAGE_BYTES, validateImageDimensions } from "./image-input";
import { SHARED_IMAGE_BYTES } from "./shared";

/** Normalize locally; the original file is never modified or uploaded here. */
export async function prepareImage(file: File): Promise<File> {
  if (!file.size || file.size > MAX_INPUT_IMAGE_BYTES) throw new Error("画像は20 MiB以下にしてください。");
  inspectImage(new Uint8Array(await file.arrayBuffer()));
  const url = URL.createObjectURL(file);
  const source = new Image();
  let canvas: HTMLCanvasElement | undefined;
  try {
    source.src = url;
    try { await source.decode(); }
    catch { throw new Error("画像を読み込めませんでした。別のPNG・JPEG・WebP画像をお試しください。"); }
    // Browsers apply EXIF orientation when decoding; use the oriented dimensions.
    validateImageDimensions(source.naturalWidth, source.naturalHeight);
    let { width, height } = fitImage(source.naturalWidth, source.naturalHeight);
    canvas = document.createElement("canvas");
    // Leave headroom for the server's lossless WebP normalization.
    const maxBytes = Math.floor(SHARED_IMAGE_BYTES * 0.75);
    for (let attempt = 0; attempt < 12; attempt++) {
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("画像を縮小できませんでした。別の画像をお試しください。");
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
      context.drawImage(source, 0, 0, width, height);
      const blob = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("画像を変換できませんでした。別の画像をお試しください。");
      if (blob.size <= maxBytes) return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" });
      width = Math.max(1, Math.floor(width * 0.75)); height = Math.max(1, Math.floor(height * 0.75));
    }
    throw new Error("画像を十分に小さくできませんでした。別の画像をお試しください。");
  } finally {
    source.removeAttribute("src"); URL.revokeObjectURL(url);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
