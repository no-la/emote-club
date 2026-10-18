"use client";

import { Fragment, useEffect, useRef, useState, type PointerEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Download, RotateCcw, Sparkles, Type, Images, Layers, SlidersHorizontal, ChevronUp, X, Undo2, Redo2 } from "lucide-react";
import { clamp, initialEffects, createTextLayer, layerName, MAX_IMAGE_BYTES, STAGE_SIZE, type EffectStack, type ElementId, type EmojiDraft, type Transform, type TextAppearance } from "@/lib/emoji/model";
import type { createEmojiRenderer, RenderResult, ElementBounds } from "@/lib/emoji/renderer";
import { loadFont } from "@/lib/emoji/fonts";
import LayerPanel, { MAX_LAYERS, LayerAppearance } from "./layer-panel";
import { Slider } from "./editor-controls";
import EffectEditor from "./effect-editor";
import SharedAssets, { type SharedAssetsHandle } from "./shared-assets";
import RegisterEmoji, { type RegisterEmojiHandle } from "./register-emoji";
import { useWorkshopIdentity, WorkshopAccount } from "./workshop-account";
import { snapAxis } from "@/lib/emoji/snapping";
import { useDraftHistory } from "./use-draft-history";
import styles from "./emoji-editor.module.css";

const mobileTabs = [["materials", "素材", Images], ["edit", "編集", SlidersHorizontal], ["layers", "レイヤー", Layers], ["effects", "効果", Sparkles]] as const;
type Renderer = Awaited<ReturnType<typeof createEmojiRenderer>>;
export default function EmojiEditor() {
  const { identity, error: identityError, refresh: refreshIdentity, setError: setIdentityError } = useWorkshopIdentity();
  const { draft, setDraft, canUndo, canRedo, begin, end, undo, redo } = useDraftHistory();
  const [selectedId, setSelected] = useState<ElementId | null>("initial-text");
  const [panel, setPanel] = useState<"layers" | "effects">("layers");
  const [mobileTab, setMobileTab] = useState("materials");
  const [editSection, setEditSection] = useState("text");
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLElement>(null);
  const exportDialog = useRef<HTMLDialogElement>(null);
  const registerControl = useRef<RegisterEmojiHandle>(null);
  const shareControl = useRef<SharedAssetsHandle>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    function resize() {
      // Leave pinch zoom to the browser; follow the keyboard and browser chrome.
      if (viewport && viewport.scale === 1) {
        root.current?.style.setProperty("--viewport-height", `${viewport.height}px`);
        root.current?.style.setProperty("--viewport-top", `${viewport.offsetTop}px`);
      }
    }
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    return () => { viewport?.removeEventListener("resize", resize); viewport?.removeEventListener("scroll", resize); };
  }, []);
  const expandButton = <button type="button" className={styles.mobileExpand} aria-label={expanded ? "パネルを縮小" : "パネルを拡大"} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><ChevronUp size={18} style={{ transform: expanded ? "rotate(180deg)" : undefined }} /></button>;
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<(RenderResult & { draft: EmojiDraft }) | null>(null);
  const [error, setError] = useState("");
  const [imageError, setImageError] = useState("");
  const [loadingImage, setLoadingImage] = useState(false);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [background, setBackground] = useState("checker");
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const uploadVersion = useRef(0);
  const uploadTarget = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  const drag = useRef<{ id: ElementId; pointer: number; x: number; y: number; start: Transform; bounds?: ElementBounds; resize?: { width: number; height: number; sx: number; sy: number } } | null>(null);

  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    async function init() {
      try {
        await loadFont("dela");
        const { createEmojiRenderer } = await import("@/lib/emoji/renderer");
        if (cancelled || !host.current) return;
        const instance = await createEmojiRenderer(host.current);
        if (cancelled) { instance.destroy(); return; }
        renderer.current = instance;
        setReady(true);
      } catch {
        if (!cancelled) setError("描画を開始できませんでした。WebGLを利用できるブラウザで再読み込みしてください。");
      }
    }
    void init();
    return () => {
      cancelled = true;
      mounted.current = false;
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let frame = 0;
    void Promise.all([...new Set(draft.layers.flatMap(layer => layer.kind === "text" ? [layer.font] : []))].map(loadFont)).then(() => {
      if (cancelled) return;
      frame = requestAnimationFrame(() => {
        try {
          const next = renderer.current?.render(draft);
          if (next) { setResult({ ...next, draft }); setError(""); }
        } catch {
          setError("プレビューを描画できませんでした。画像やエフェクトの設定を変更してみてください。");
        }
      });
    }).catch(() => { if (!cancelled) setError("フォントを読み込めませんでした。もう一度選んでください。"); });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [draft, ready]);

  const selected = draft.layers.some(layer => layer.id === selectedId) ? selectedId : draft.layers.at(-1)?.id ?? null;
  const selectedLayer = draft.layers.find(layer => layer.id === selected);
  function updateLayerEffects(id: string, stack: EffectStack) {
    setDraft(previous => ({ ...previous, layers: previous.layers.map(layer => layer.id === id ? { ...layer, ...stack } : layer) }));
  }
  function updateText(change: Partial<TextAppearance & { text: string }>) {
    setDraft(previous => ({ ...previous, layers: previous.layers.map(layer => layer.id === selected && layer.kind === "text" ? { ...layer, ...change } : layer) }));
  }
  function transform(id: ElementId, change: Partial<Transform>) {
    setDraft(previous => ({ ...previous, layers: previous.layers.map(layer => layer.id === id ? { ...layer, transform: { ...layer.transform, ...change } } : layer) }));
  }
  function selectLayer(id: string) { setSelected(id); setPanel("layers"); }
  function addText() {
    if (loadingImage || draft.layers.length >= MAX_LAYERS) return;
    const layer = createTextLayer(crypto.randomUUID());
    setDraft(previous => ({ ...previous, layers: [...previous.layers, layer] }));
    selectLayer(layer.id); setMobileTab("edit"); setEditSection("text");
  }
  function moveLayer(id: string, delta: number) {
    setDraft(previous => {
      const layers = [...previous.layers];
      const index = layers.findIndex(layer => layer.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= layers.length) return previous;
      [layers[index], layers[target]] = [layers[target], layers[index]];
      return { ...previous, layers };
    });
  }
  function reorderLayer(id: string, targetId: string, before: boolean) {
    setDraft(previous => {
      if (id === targetId) return previous;
      const display = [...previous.layers].reverse();
      const layer = display.find(item => item.id === id);
      if (!layer || !display.some(item => item.id === targetId)) return previous;
      const remaining = display.filter(item => item.id !== id);
      const index = remaining.findIndex(item => item.id === targetId);
      remaining.splice(index + (before ? 0 : 1), 0, layer);
      return { ...previous, layers: remaining.reverse() };
    });
  }
  function duplicateLayer(id: string) {
    const original = draft.layers.find(layer => layer.id === id);
    if (!original || loadingImage || draft.layers.length >= MAX_LAYERS) return;
    const copy = { ...original, ...structuredClone({ effects: original.effects, effectSettings: original.effectSettings }), id: crypto.randomUUID(), transform: { ...original.transform, x: clamp(original.transform.x + 16, 0, STAGE_SIZE), y: clamp(original.transform.y + 16, 0, STAGE_SIZE) } };
    setDraft(previous => {
      const layers = [...previous.layers];
      layers.splice(layers.findIndex(layer => layer.id === id) + 1, 0, copy);
      return { ...previous, layers };
    });
    selectLayer(copy.id);
  }
  function removeLayer(id: string) {
    if (uploadTarget.current === id) {
      ++uploadVersion.current;
      uploadTarget.current = undefined;
      setLoadingImage(false);
    }
    const index = draft.layers.findIndex(layer => layer.id === id);
    const remaining = draft.layers.filter(layer => layer.id !== id);
    setDraft(previous => ({ ...previous, layers: previous.layers.filter(layer => layer.id !== id) }));
    if (selected === id) setSelected(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
    finishDrag();
  }
  function autoLayout() {
    const count = draft.layers.length;
    const columns = count <= 2 ? 1 : Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    const width = STAGE_SIZE / columns, height = STAGE_SIZE / Math.max(rows, 1);
    setDraft(previous => ({ ...previous, layers: previous.layers.map((layer, index) => {
      const bounds = result?.bounds[layer.id];
      const scale = bounds ? Math.min(1, (width - 32) / (bounds.width / layer.transform.scale), (height - 32) / (bounds.height / layer.transform.scale)) : 1;
      return { ...layer, transform: { x: (index % columns + 0.5) * width, y: (Math.floor(index / columns) + 0.5) * height, scale: clamp(scale, 0.2, 4) } };
    }) }));
  }
  async function loadImage(file?: File, replaceId?: string) {
    if (!file || (!replaceId && draft.layers.length >= MAX_LAYERS)) return;
    const version = ++uploadVersion.current;
    uploadTarget.current = replaceId;
    setImageError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setLoadingImage(false);
      setImageError("PNG・JPEG・WebPの画像を選んでください。"); return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setLoadingImage(false);
      setImageError("画像は5 MB以下にしてください。"); return;
    }
    setLoadingImage(true);
    const url = URL.createObjectURL(file);
    try {
      const element = new Image();
      element.src = url;
      await element.decode();
      if (element.naturalWidth * element.naturalHeight > 16_000_000) throw new Error("large");
      if (!mounted.current || version !== uploadVersion.current) return;
      const id = replaceId ?? crypto.randomUUID();
      setDraft(previous => ({ ...previous, layers: replaceId ? previous.layers.map(layer => layer.id === id && layer.kind === "image" ? { ...layer, source: element, name: file.name } : layer) : previous.layers.length < MAX_LAYERS ? [...previous.layers, { ...initialEffects(), id, kind: "image", opacity: 1, source: element, name: file.name, transform: { x: 256, y: 256, scale: 1 } }] : previous.layers }));
      if (!replaceId || draft.layers.some(layer => layer.id === replaceId)) { selectLayer(id); }
    } catch {
      if (mounted.current && version === uploadVersion.current) setImageError("画像を読み込めませんでした。縦×横が1600万画素以下の別の画像をお試しください。");
    } finally {
      URL.revokeObjectURL(url);
      if (mounted.current && version === uploadVersion.current) { setLoadingImage(false); uploadTarget.current = undefined; }
    }
  }
  function beginDrag(event: PointerEvent<HTMLButtonElement>, id: ElementId) {
    if (event.button !== 0) return;
    begin("pointer");
    selectLayer(id);
    const layer = draft.layers.find(layer => layer.id === id);
    if (!layer) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, start: { ...layer.transform }, bounds: result?.bounds[id] };
  }
  function beginResize(event: PointerEvent<HTMLButtonElement>, id: ElementId, sx: number, sy: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    beginDrag(event, id);
    const bounds = result?.bounds[id];
    if (drag.current && bounds) drag.current.resize = { width: bounds.width, height: bounds.height, sx, sy };
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId || !stage.current) return;
    const ratio = STAGE_SIZE / stage.current.getBoundingClientRect().width;
    if (current.resize) {
      const { width, height, sx, sy } = current.resize;
      const dx = (event.clientX - current.x) * ratio;
      const dy = (event.clientY - current.y) * ratio;
      // Project onto the diagonal to preserve aspect ratio and the opposite corner.
      const factor = 1 + (sx * dx * width + sy * dy * height) / Math.max(width * width + height * height, 1);
      const scale = clamp(current.start.scale * factor, 0.2, 4);
      const change = scale / current.start.scale - 1;
      transform(current.id, {
        scale,
        x: clamp(current.start.x + sx * width * change / 2, 0, STAGE_SIZE),
        y: clamp(current.start.y + sy * height * change / 2, 0, STAGE_SIZE),
      });
      return;
    }
    const x = clamp(current.start.x + (event.clientX - current.x) * ratio, 0, STAGE_SIZE);
    const y = clamp(current.start.y + (event.clientY - current.y) * ratio, 0, STAGE_SIZE);
    if (event.shiftKey || !current.bounds) {
      setGuides({ x: null, y: null });
      transform(current.id, { x, y });
      return;
    }
    const snapX = snapAxis(x, current.start.x, current.bounds.x, current.bounds.width, 6 * ratio);
    const snapY = snapAxis(y, current.start.y, current.bounds.y, current.bounds.height, 6 * ratio);
    setGuides({ x: snapX.guide, y: snapY.guide });
    transform(current.id, { x: snapX.position, y: snapY.position });
  }
  function finishDrag() {
    drag.current = null;
    setGuides({ x: null, y: null });
  }

  const hasContent = draft.layers.some(layer => layer.kind === "image" || layer.text.trim());
  const currentTransform = selectedLayer?.transform;
  const currentResult = result?.draft === draft && !error;
  const canExport = ready && hasContent && currentResult && !loadingImage;

  function savePng() {
    if (!result || !canExport) return;
    const link = document.createElement("a");
    link.href = result.exportUrl; link.download = "emote-club.png"; link.click();
  }
  return <main onPointerDownCapture={() => begin("pointer")} onFocusCapture={event => { if (event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLInputElement && ["text", "number", "range"].includes(event.target.type))) begin(event.target instanceof HTMLInputElement && event.target.type === "range" ? "pointer" : "text"); }} onBlurCapture={end} ref={root} className={styles.workshop} data-mobile-panel={mobileTab} data-edit-section={editSection} data-expanded={expanded}>
    <div className={styles.heading}>
      <div className={styles.headingIdentity}><Link href="/" className={styles.backLink}>Emote Club</Link><h1>絵文字エディタ</h1></div>
      <div className={styles.mobileHeaderActions}><button type="button" aria-label="文字を追加" disabled={loadingImage || draft.layers.length >= MAX_LAYERS} onClick={addText}><Type size={19} /></button><button type="button" className={styles.download} onClick={() => exportDialog.current?.showModal()}>書き出す</button></div>
      <WorkshopAccount identity={identity} error={identityError} onRefresh={refreshIdentity} onError={setIdentityError} />
      <RegisterEmoji key={`${identity?.user?.id || "guest"}:${identity?.guild?.id || ""}`} controlRef={registerControl} identity={identity} image={canExport ? result?.url : undefined} canExport={!!canExport} />
      <button className={styles.download} type="button" disabled={!canExport} onClick={savePng}><Download size={16} /> PNGを保存</button>
    </div>
    <div className={styles.workspace}>
      <aside className={styles.assetSidebar} aria-label="共有素材とレイヤー">
        <SharedAssets key={`${identity?.user?.id || "guest"}:${identity?.guild?.id || ""}`} controlRef={shareControl} headingAction={expandButton} identity={identity} identityError={identityError}
          canAdd={!loadingImage && draft.layers.length < MAX_LAYERS} onUse={file => loadImage(file)} onRefreshIdentity={refreshIdentity}
          canvasImage={canExport ? result?.url : undefined} canvasName={draft.layers.filter(layer => layer.kind === "text").map(layer => layer.text).join(" ").slice(0, 80)} />
        <section className={styles.layerSidebar} aria-label="レイヤー一覧">
          <div className={styles.sidebarHeading}><h2>レイヤー</h2><small>上が手前</small>{expandButton}</div>
          <LayerPanel layers={draft.layers} selected={panel === "layers" ? selectedLayer : undefined} loading={loadingImage} imageError={imageError}
            onSelect={selectLayer} onAddText={addText} onLoadImage={(file, id) => { void loadImage(file, id); }}
            onReorder={reorderLayer} onMove={moveLayer} onDuplicate={duplicateLayer} onRemove={removeLayer} />
        </section>
      </aside>
      <section className={styles.previewPanel} aria-label="絵文字のプレビュー">
        <div className={styles.previewTools}>
          <div className={styles.mobileHistory}><button type="button" aria-label="元に戻す" disabled={!canUndo || loadingImage} onClick={undo}><Undo2 size={18} /></button><button type="button" aria-label="やり直す" disabled={!canRedo || loadingImage} onClick={redo}><Redo2 size={18} /></button></div>
          <button type="button" className={styles.quietButton} onClick={autoLayout} title="画像と文字の位置・大きさを自動で整える"><RotateCcw size={14} /> 自動配置</button>
          <button type="button" className={`${styles.quietButton} ${styles.globalEffectsButton}`} aria-label="全体の効果" aria-pressed={panel === "effects"} onClick={() => { setPanel("effects"); setMobileTab("effects"); }}><Sparkles size={14} />全体の効果{draft.effects.length > 0 && <span className={styles.effectBadge}>{draft.effects.length}</span>}</button>
          <div className={styles.backgrounds} aria-label="確認用の背景色">
            {[["checker", "透明"], ["light", "明るい背景"], ["dark", "暗い背景"]].map(([value, label]) =>
              <button key={value} type="button" className={styles[value]} title={label} aria-label={label} onClick={() => setBackground(value)} aria-pressed={background === value} />)}
          </div>
        </div>
        <div className={styles.stageWrap}>
          <div ref={stage} className={`${styles.stage} ${styles[background]}`}>
            <div ref={host} className={styles.canvasHost} />
            {ready && !hasContent && <p className={styles.empty}>文字か画像を追加</p>}
            {!ready && !error && <p className={styles.empty}>読み込み中…</p>}
            {/* Refs in this map are accessed only by pointer/keyboard event handlers. */}
            {/* eslint-disable-next-line react-hooks/refs */}
            {result && draft.layers.map((layer, index) => {
              const id = layer.id;
              const objectLabel = `レイヤー${index + 1}（${layerName(layer)}）`;
              const b = result.bounds[id];
              if (!b) return null;
              return <Fragment key={id}><button type="button" data-canvas-layer={id} aria-label={`${objectLabel}を移動`} aria-pressed={selected === id && panel === "layers"}
                title="ドラッグで移動・端や中央にスナップ／Shiftで解除・矢印キーで微調整"
                className={`${styles.selection} ${selected === id && panel === "layers" ? styles.selected : ""}`}
                style={{ left: `${b.x / STAGE_SIZE * 100}%`, top: `${b.y / STAGE_SIZE * 100}%`, width: `${b.width / STAGE_SIZE * 100}%`, height: `${b.height / STAGE_SIZE * 100}%` }}
                onPointerDown={(event) => beginDrag(event, id)} onPointerMove={moveDrag}
                onPointerUp={event => { const current = drag.current; if (current && !current.resize && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) setMobileTab("edit"); finishDrag(); }} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
                onFocus={() => selectLayer(id)} onKeyDown={(event) => {
                  const delta = event.shiftKey ? 10 : 2;
                  const offset: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
                  if (!offset[event.key]) return;
                  event.preventDefault();
                  const position = layer.transform;
                  transform(id, { x: clamp(position.x + offset[event.key][0], 0, STAGE_SIZE), y: clamp(position.y + offset[event.key][1], 0, STAGE_SIZE) });
                }} />
                {selected === id && panel === "layers" && ([[-1, -1, "左上"], [1, -1, "右上"], [-1, 1, "左下"], [1, 1, "右下"]] as const).map(([sx, sy, corner]) =>
                  <button key={corner} type="button" className={styles.resizeHandle}
                    aria-label={`${objectLabel}の大きさを変更（${corner}）`}
                    title="ドラッグで拡大・縮小／矢印キーで微調整"
                    style={{ left: `${(b.x + (sx === 1 ? b.width : 0)) / STAGE_SIZE * 100}%`, top: `${(b.y + (sy === 1 ? b.height : 0)) / STAGE_SIZE * 100}%`, cursor: sx === sy ? "nwse-resize" : "nesw-resize" }}
                    onPointerDown={event => beginResize(event, id, sx, sy)} onPointerMove={moveDrag}
                    onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
                    onKeyDown={event => {
                      const direction = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
                      if (!direction) return;
                      event.preventDefault();
                      const value = layer.transform;
                      transform(id, { scale: clamp(value.scale + direction * (event.shiftKey ? 0.1 : 0.01), 0.2, 4) });
                    }} />)}
              </Fragment>;
            })}
            {guides.x !== null && <span aria-hidden="true" data-snap-guide="x" className={styles.guideX} style={{ left: `${guides.x / STAGE_SIZE * 100}%` }} />}
            {guides.y !== null && <span aria-hidden="true" data-snap-guide="y" className={styles.guideY} style={{ top: `${guides.y / STAGE_SIZE * 100}%` }} />}
          </div>
        </div>
        <div className={styles.previewFooter}>
          <div className={`${styles.actualSize} ${styles[background]}`} aria-label="小さい表示で確認">
            <span className={styles.smallEmoji} role="img" aria-label="32pxの絵文字" style={{ backgroundImage: result ? `url("${result.url}")` : undefined }} />
            <span className={styles.tinyEmoji} role="img" aria-label="16pxの絵文字" style={{ backgroundImage: result ? `url("${result.url}")` : undefined }} />
          </div>
          <span className={styles.muted}>PNG保存 512 × 512 · Discord 128 × 128</span>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </section>
      <section className={styles.inspector} aria-label="絵文字の編集">
        <div className={styles.inspectorHeading}>
          {expandButton}<button className={styles.mobileDone} type="button" onClick={() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }}>完了</button>
          <h2>{panel === "effects" ? "全体の効果" : selectedLayer ? layerName(selectedLayer) : "レイヤーを選択"}</h2>
          {panel === "effects" && selectedLayer && <button type="button" className={styles.quietButton} aria-label="レイヤーの編集に戻る" title="レイヤーの編集に戻る" onClick={() => setPanel("layers")}><ArrowLeft size={15} /></button>}
        </div>
        <div className={styles.mobileCategories} aria-label="編集項目">
          {mobileTab === "effects" ? <><button type="button" aria-pressed={panel === "layers"} disabled={!selectedLayer} onClick={() => setPanel("layers")}>このレイヤー</button><button type="button" aria-pressed={panel === "effects"} onClick={() => setPanel("effects")}>全体</button></> : <>{[["text", selectedLayer?.kind === "image" ? "画像" : "文字"], ["color", "色・縁・影"], ["spacing", "字間・行間"], ["transform", "大きさ・透明度"]].filter(([key]) => selectedLayer?.kind !== "image" || key === "text" || key === "transform").map(([key, label]) => <button key={key} type="button" aria-pressed={editSection === key} onClick={() => setEditSection(key)}>{label}</button>)}</>}
        </div>
        <div className={styles.settings} key={panel === "layers" ? selectedLayer?.id ?? "empty" : "all"}>
          {panel === "layers" && selectedLayer && <>
            <div className={styles.layerAppearance}><LayerAppearance layer={selectedLayer} loading={loadingImage} onTextChange={updateText} onLoadImage={(file, id) => { void loadImage(file, id); }} /></div>
            {currentTransform && <div className={styles.transform}>
              <Slider label="不透明度" value={Math.round((selectedLayer.opacity ?? 1) * 100)} min={0} max={100} unit="%" onChange={value => setDraft(previous => ({ ...previous, layers: previous.layers.map(layer => layer.id === selectedLayer.id ? { ...layer, opacity: value / 100 } : layer) }))} />
              <Slider label="大きさ" value={Math.round(currentTransform.scale * 100)} min={20} max={400} unit="%" onChange={value => transform(selectedLayer.id, { scale: value / 100 })} />
              <details className={styles.details}>
                <summary>位置を数値で調整</summary>
                <div className={styles.positionFields}>
                  <label>横<input type="number" min={0} max={128} value={Math.round(currentTransform.x / 4)} onChange={event => transform(selectedLayer.id, { x: clamp(Number(event.target.value) * 4, 0, STAGE_SIZE) })} /></label>
                  <label>縦<input type="number" min={0} max={128} value={Math.round(currentTransform.y / 4)} onChange={event => transform(selectedLayer.id, { y: clamp(Number(event.target.value) * 4, 0, STAGE_SIZE) })} /></label>
                </div>
              </details>
            </div>}
            <div className={styles.layerEffects}><EffectEditor value={selectedLayer} label="効果" onChange={stack => updateLayerEffects(selectedLayer.id, stack)} /></div>
          </>}
          {panel === "effects" && <EffectEditor value={draft} label="効果" onChange={stack => setDraft(previous => ({ ...previous, ...stack }))} />}
        </div>
      </section>
    </div>
    <nav className={styles.mobileNav} aria-label="編集パネル">
      {mobileTabs.map(([key, label, Icon]) => <button key={key} type="button" aria-pressed={mobileTab === key} onClick={() => {
        setMobileTab(key);
        if (key === "edit") setPanel("layers");
        if (key === "effects" && !selectedLayer) setPanel("effects");
      }}><Icon size={20} />{label}</button>)}
    </nav>
    <dialog ref={exportDialog} className={styles.exportDialog} aria-labelledby="export-title">
      <header><h2 id="export-title">書き出す</h2><button type="button" aria-label="書き出しを閉じる" onClick={() => exportDialog.current?.close()}><X size={20} /></button></header>
      <button type="button" disabled={!canExport} onClick={() => { savePng(); exportDialog.current?.close(); }}><Download size={22} /><span>PNGを保存<small>512 × 512・透過PNG</small></span></button>
      <button type="button" onClick={() => { exportDialog.current?.close(); registerControl.current?.open(); }}><Sparkles size={22} /><span>サーバーに追加<small>Discord用・128 × 128</small></span></button>
      <button type="button" disabled={!canExport || !identity?.guild || !identity?.storageConfigured} onClick={() => { exportDialog.current?.close(); setMobileTab("materials"); requestAnimationFrame(() => shareControl.current?.shareCanvas()); }}><Images size={22} /><span>共有素材にする<small>選択中のサーバーのみんなに共有</small></span></button>
    </dialog>
  </main>;
}
