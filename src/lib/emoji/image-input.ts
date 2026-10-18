export const MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_INPUT_IMAGE_PIXELS = 48_000_000;
export const MAX_IMAGE_EDGE = 2048;
const invalid = () => new Error("PNG・JPEG・WebPの静止画像を選んでください。");

/** Inspect encoded dimensions before allocating a decoded image. Not a server trust boundary. */
export function inspectImage(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number, value: string) => [...value].every((char, i) => bytes[offset + i] === char.charCodeAt(0));
  let width = 0, height = 0;
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n) && tag(12, "IHDR")) {
    width = view.getUint32(16); height = view.getUint32(20);
    let ended = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = view.getUint32(offset);
      if (offset + size + 12 > bytes.length) throw invalid();
      if (tag(offset + 4, "acTL")) throw invalid();
      if (tag(offset + 4, "IEND")) { ended = true; break; }
      offset += size + 12;
    }
    if (!ended) throw invalid();
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 3 < bytes.length;) {
      if (bytes[offset++] !== 255) throw invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) throw invalid();
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) throw invalid();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (size < 8) throw invalid();
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += size;
    }
  } else if (bytes.length >= 20 && tag(0, "RIFF") && tag(8, "WEBP")) {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset + 4, true), start = offset + 8;
      if (start + size > bytes.length) throw invalid();
      if (tag(offset, "ANIM") || tag(offset, "ANMF")) throw invalid();
      if (tag(offset, "VP8X") && size >= 10) {
        if (bytes[start] & 2) throw invalid();
        width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
        height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
      } else if (!width && tag(offset, "VP8 ") && size >= 10 && bytes[start + 3] === 0x9d && bytes[start + 4] === 1 && bytes[start + 5] === 0x2a) {
        width = view.getUint16(start + 6, true) & 0x3fff; height = view.getUint16(start + 8, true) & 0x3fff;
      } else if (!width && tag(offset, "VP8L") && size >= 5 && bytes[start] === 0x2f) {
        const bits = view.getUint32(start + 1, true);
        width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
      }
      offset = start + size + (size % 2);
    }
  }
  validateImageDimensions(width, height);
  return { width, height };
}
export function validateImageDimensions(width: number, height: number) {
  if (!width || !height) throw invalid();
  if (width * height > MAX_INPUT_IMAGE_PIXELS || Math.max(width, height) > 32768) throw new Error("画像は4800万画素以下・一辺32768px以下にしてください。");
}
export function fitImage(width: number, height: number, edge = MAX_IMAGE_EDGE) {
  const ratio = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
