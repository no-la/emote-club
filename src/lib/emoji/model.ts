export const STAGE_SIZE = 512;
export const OUTPUT_SIZE = 128;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export type ElementId = string;
export type Transform = { x: number; y: number; scale: number };
export const EFFECTS = {
  wave: { name: "うねうね", control: "強さ" },
  glow: { name: "ふちが光る", control: "光の広がり" },
  pixel: { name: "ドット", control: "粗さ" },
  rgb: { name: "ずれ", control: "ずれ幅" },
} as const;
export type EffectId = keyof typeof EFFECTS;
export type TextAppearance = {
  font: FontId;
  color: string;
  outlineColor: string;
  outline: number;
  shadow: number;
  shadowColor: string;
  shadowBlur: number;
};
export type EffectStack = {
  effects: EffectId[];
  effectSettings: {
    wave: { strength: number; phase: number; angle: number };
    glow: { strength: number; color: string };
    pixel: { strength: number };
    rgb: { strength: number; angle: number };
  };
};
export type TextLayer = TextAppearance & EffectStack & { id: ElementId; kind: "text"; text: string; transform: Transform };
export type ImageLayer = EffectStack & { id: ElementId; kind: "image"; source: HTMLImageElement; name: string; transform: Transform };
export type EmojiLayer = TextLayer | ImageLayer;
export type EmojiDraft = EffectStack & { layers: EmojiLayer[] };
export function initialEffects(): EffectStack {
  return {
    effects: [],
    effectSettings: {
      wave: { strength: 8, phase: 0, angle: 0 }, glow: { strength: 8, color: "#ffc740" },
      pixel: { strength: 8 }, rgb: { strength: 8, angle: 0 },
    },
  };
}
export const FONTS = {
  dela: { name: "Dela Gothic One", family: "Emoji dela", file: "/fonts/dela-gothic-one/DelaGothicOne-Regular.ttf" },
  dot: { name: "DotGothic16", family: "Emoji dot", file: "/fonts/dotgothic16/DotGothic16-Regular.woff2" },
  yusei: { name: "Yusei Magic", family: "Emoji yusei", file: "/fonts/yuseimagic/YuseiMagic-Regular.woff2" },
  mochiy: { name: "Mochiy Pop One", family: "Emoji mochiy", file: "/fonts/mochiypopone/MochiyPopOne-Regular.woff2" },
  stick: { name: "Stick", family: "Emoji stick", file: "/fonts/stick/Stick-Regular.woff2" },
  wdxl: { name: "WDXL Lubrifont JP N", family: "Emoji wdxl", file: "/fonts/wdxllubrifontjpn/WDXLLubrifontJPN-Regular.woff2" },
  poprum: { name: "ポプらむ☆キウイ", family: "Emoji poprum", file: "/fonts/poprumkiwi/PopRumKiwi-Telop.woff2" },
  nikumaru: { name: "にくまるフォント", family: "Emoji nikumaru", file: "/fonts/nikumaru/nikumaru.woff2" },
  akazukin: { name: "あかずきんポップ", family: "Emoji akazukin", file: "/fonts/akazukin/AkazukiPOP.woff2" },
  kei: { name: "けいふぉんと！", family: "Emoji kei", file: "/fonts/keifont/keifont.woff2" },
  maka: { name: "851マカポップ", family: "Emoji maka", file: "/fonts/851-makapop/851MkPOP_101.woff2" },
  chikara: { name: "851チカラヨワク", family: "Emoji chikara", file: "/fonts/851-chikarayowaku/851CHIKARA-YOWAKU_002.woff2" },
  sans: { name: "ゴシック", family: '"Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif', file: "" },
  serif: { name: "明朝", family: '"Hiragino Mincho ProN", "Yu Mincho", serif', file: "" },
} as const;
export type FontId = keyof typeof FONTS;
export const FONT_FAMILIES = Object.fromEntries(Object.entries(FONTS).map(([id, font]) =>
  [id, font.file ? `"${font.family}", sans-serif` : font.family])) as Record<FontId, string>;
export function createTextLayer(id: string, text = "文字"): TextLayer {
  return {
    ...initialEffects(), id, kind: "text", text, font: "dela", color: "#ffe477", outlineColor: "#292329",
    outline: 10, shadow: 0, shadowColor: "#121218", shadowBlur: 0,
    transform: { x: 256, y: 256, scale: 1 },
  };
}
export function layerName(layer: EmojiLayer) {
  return layer.kind === "text" ? layer.text.trim().replace(/\s+/g, " ") || "文字" : layer.name;
}
export function initialDraft(): EmojiDraft {
  return { ...initialEffects(), layers: [createTextLayer("initial-text", "えらい")] };
}
export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
