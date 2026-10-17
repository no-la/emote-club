import { FONTS, type FontId } from "./model";
const pending = new Map<FontId, Promise<void>>();
export function loadFont(id: FontId): Promise<void> {
  if (!FONTS[id].file) return Promise.resolve();
  const existing = pending.get(id);
  if (existing) return existing;
  const font = FONTS[id];
  const request = new FontFace(font.family, `url("${font.file}")`).load().then(face => {
    document.fonts.add(face);
  }).catch(error => { pending.delete(id); throw error; });
  pending.set(id, request);
  return request;
}
