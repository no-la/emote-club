import { AlphaFilter, Application, CanvasTextMetrics, Container, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { createEffectPipeline } from "./effect-pipeline";
import { FONT_FAMILIES, OUTPUT_SIZE, STAGE_SIZE, type EmojiDraft, type ElementId } from "./model";

export type ElementBounds = { x: number; y: number; width: number; height: number };
export type RenderResult = { url: string; exportUrl: string; bounds: Partial<Record<ElementId, ElementBounds>> };

export async function createEmojiRenderer(host: HTMLElement) {
  const app = new Application();
  await app.init({
    width: STAGE_SIZE, height: STAGE_SIZE, backgroundAlpha: 0,
    antialias: true, resolution: 1, preference: "webgl", autoStart: false,
  });
  const canvas = app.canvas;
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);
  const artwork = new Container();
  app.stage.addChild(artwork);
  const objects = new Map<ElementId, Sprite | Text>();
  const opacityFilters = new Map<ElementId, AlphaFilter>();
  const layerRoots = new Map<ElementId, Container>();
  const textures = new Map<HTMLImageElement, Texture>();
  const globalEffects = createEffectPipeline();
  const layerEffects = new Map<ElementId, ReturnType<typeof createEffectPipeline>>();
  // Keep effect coordinates stable when text or image bounds change.
  artwork.filterArea = new Rectangle(0, 0, STAGE_SIZE, STAGE_SIZE);

  return {
    render(draft: EmojiDraft): RenderResult {
      const ids = new Set(draft.layers.map(layer => layer.id));
      for (const id of objects.keys()) {
        if (!ids.has(id)) {
          const root = layerRoots.get(id)!;
          root.filters = [];
          opacityFilters.get(id)?.destroy(); opacityFilters.delete(id);
          layerEffects.get(id)?.destroy(); layerEffects.delete(id);
          root.destroy({ children: true }); layerRoots.delete(id); objects.delete(id);
        }
      }
      const sources = new Set(draft.layers.flatMap(layer => layer.kind === "image" ? [layer.source] : []));
      const bounds: RenderResult["bounds"] = {};
      for (const [index, layer] of draft.layers.entries()) {
        let object = objects.get(layer.id);
        if (!object) {
          object = layer.kind === "text" ? new Text({ text: "", resolution: 2 }) : new Sprite();
          object.anchor.set(0.5);
          objects.set(layer.id, object);
          // Filter areas are local to their container. Keep this wrapper untransformed
          // so moving/scaling the object never shifts or crops the effect's stage frame.
          const root = new Container();
          root.addChild(object);
          root.filterArea = new Rectangle(0, 0, STAGE_SIZE, STAGE_SIZE);
          layerRoots.set(layer.id, root);
          opacityFilters.set(layer.id, new AlphaFilter());
          artwork.addChild(root);
          layerEffects.set(layer.id, createEffectPipeline());
        }
        const root = layerRoots.get(layer.id)!;
        artwork.setChildIndex(root, index);
        object.visible = layer.kind === "image" || Boolean(layer.text.trim());
        if (layer.kind === "image" && object instanceof Sprite) {
          let texture = textures.get(layer.source);
          if (!texture) { texture = Texture.from(layer.source); textures.set(layer.source, texture); }
          object.texture = texture;
          const fit = 430 / Math.max(layer.source.naturalWidth, layer.source.naturalHeight);
          object.scale.set(fit * layer.transform.scale);
        } else if (layer.kind === "text" && object instanceof Text) {
          object.text = layer.text;
          object.style = {
            fontFamily: FONT_FAMILIES[layer.font], fontSize: 170,
            letterSpacing: 170 * (layer.letterSpacing ?? 0) / 100,
            fontWeight: layer.font === "sans" || layer.font === "serif" ? "bold" : "normal",
            fill: layer.color, align: "center", padding: 32,
            stroke: layer.outline ? { color: layer.outlineColor, width: layer.outline, join: "round" } : undefined,
            wordWrap: false,
          };
          if (layer.lineSpacing) {
            const metrics = CanvasTextMetrics.measureText(layer.text, object.style);
            // Use lineHeight so Pixi reserves the extra space above/below the lines too.
            object.style.lineHeight = Math.max(1, metrics.fontProperties.fontSize + 170 * layer.lineSpacing / 100);
          }
          object.scale.set(1);
          const fit = Math.min(1, 450 / Math.max(object.width, 1), 440 / Math.max(object.height, 1));
          object.scale.set(fit * layer.transform.scale);
        }
        object.position.set(layer.transform.x, layer.transform.y);
        root.visible = object.visible;
        const effects = layerEffects.get(layer.id)!.update(layer);
        const opacity = opacityFilters.get(layer.id)!;
        opacity.alpha = layer.opacity ?? 1;
        // Fade the completed layer, including its outlines, shadows and effects.
        root.filters = opacity.alpha < 1 ? [...effects, opacity] : effects;
        if (object.visible) {
          const b = object.getBounds();
          bounds[layer.id] = { x: b.x, y: b.y, width: b.width, height: b.height };
        }
      }
      for (const [source, texture] of textures) {
        if (!sources.has(source)) { texture.destroy(true); textures.delete(source); }
      }
      artwork.filters = globalEffects.update(draft);
      app.render();
      // A fixed frame keeps empty margins and clips artwork to the same square
      // as the editor. The selection controls/background are not in this scene.
      const extracted = app.renderer.extract.canvas({
        target: artwork, frame: new Rectangle(0, 0, STAGE_SIZE, STAGE_SIZE),
        resolution: 1, clearColor: [0, 0, 0, 0],
      }) as HTMLCanvasElement;
      const output = document.createElement("canvas");
      output.width = output.height = OUTPUT_SIZE;
      const ctx = output.getContext("2d");
      if (!ctx) throw new Error("PNGの書き出しを準備できませんでした。");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(extracted, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      return { url: output.toDataURL("image/png"), exportUrl: extracted.toDataURL("image/png"), bounds };
    },
    destroy() {
      canvas.remove();
      artwork.filters = [];
      globalEffects.destroy();
      for (const [id, pipeline] of layerEffects) {
        const root = layerRoots.get(id);
        if (root) root.filters = [];
        pipeline.destroy();
      }
      layerEffects.clear();
      for (const filter of opacityFilters.values()) filter.destroy();
      opacityFilters.clear();
      app.destroy(true, { children: true, texture: false, textureSource: false });
      for (const texture of textures.values()) texture.destroy(true);
      textures.clear();
      objects.clear();
      layerRoots.clear();
    },
  };
}
