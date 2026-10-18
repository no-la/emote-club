"use client";

import { ArrowUp, ArrowDown, Copy, Trash2, Type, ImagePlus, Sparkles, GripVertical } from "lucide-react";
import { useState, type ReactNode } from "react";
import { layerName, type EmojiLayer, type TextLayer, type TextAppearance } from "@/lib/emoji/model";
import { ColorPalette, Slider } from "./editor-controls";
import FontPicker from "./font-picker";
import styles from "./emoji-editor.module.css";

export const MAX_LAYERS = 16;
export default function LayerPanel({ layers, selected, loading, imageError, onSelect, onAddText, onLoadImage, onReorder, onMove, onDuplicate, onRemove, children }: {
  layers: EmojiLayer[]; selected: EmojiLayer | undefined; loading: boolean; imageError: string;
  onSelect: (id: string) => void; onAddText: () => void; onLoadImage: (file?: File, replaceId?: string) => void;
  onReorder: (id: string, targetId: string, before: boolean) => void;
  onMove: (id: string, delta: number) => void; onDuplicate: (id: string) => void; onRemove: (id: string) => void;
  children?: ReactNode;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; before: boolean } | null>(null);
  function clearDrag() { setDragged(null); setDrop(null); }
  const atLimit = layers.length >= MAX_LAYERS;
  const index = layers.findIndex(layer => layer.id === selected?.id);
  return <>
    <div className={styles.layerAdd}>
      <button type="button" aria-label="文字を追加" title="文字を追加" onClick={onAddText} disabled={atLimit || loading}><Type size={15} />文字</button>
      <label className={styles.addImage} aria-disabled={loading || atLimit}>
        <ImagePlus size={15} />{loading ? "読込中…" : "画像"}
        <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="画像を追加" disabled={loading || atLimit} onChange={event => { onLoadImage(event.target.files?.[0]); event.target.value = ""; }} />
      </label>
    </div>
    {children}
    {atLimit && <p className={styles.layerHint}>追加できるレイヤーは16個までです</p>}
    <ul className={styles.layerList} aria-label="レイヤー（上が手前）">
      {[...layers].reverse().map((layer, index) => <li key={layer.id}
        data-dragging={dragged === layer.id || undefined}
        data-drop={drop?.id === layer.id ? (drop.before ? "before" : "after") : undefined}
        onDragOver={event => {
          if (!dragged || dragged === layer.id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const rect = event.currentTarget.getBoundingClientRect();
          setDrop({ id: layer.id, before: event.clientY < rect.top + rect.height / 2 });
        }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null); }}
        onDrop={event => {
          event.preventDefault();
          if (dragged && dragged !== layer.id) {
            const rect = event.currentTarget.getBoundingClientRect();
            onReorder(dragged, layer.id, event.clientY < rect.top + rect.height / 2);
          }
          clearDrag();
        }}>

        <button type="button" draggable title="ドラッグで並べ替え"
          onDragStart={event => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", layer.id);
            setDragged(layer.id); onSelect(layer.id);
          }} onDragEnd={clearDrag}
          aria-pressed={layer.id === selected?.id} data-layer-id={layer.id} aria-label={`レイヤー${layers.length - index}: ${layerName(layer)}`} onClick={() => onSelect(layer.id)}>
          <GripVertical size={13} className={styles.layerGrip} aria-hidden="true" />{layer.kind === "text" ? <Type size={14} /> : <ImagePlus size={14} />}<span>{layerName(layer)}</span>{layer.effects.length > 0 && <Sparkles size={12} aria-label="効果あり" />}
        </button>
      </li>)}
    </ul>
    {selected && <div className={styles.layerActions} aria-label="選択レイヤーの操作">
      <button type="button" aria-label="レイヤーを手前へ" title="手前へ" disabled={index === layers.length - 1} onClick={() => onMove(selected.id, 1)}><ArrowUp size={15} /></button>
      <button type="button" aria-label="レイヤーを奥へ" title="奥へ" disabled={index === 0} onClick={() => onMove(selected.id, -1)}><ArrowDown size={15} /></button>
      <button type="button" aria-label="レイヤーを複製" title="複製" disabled={atLimit || loading} onClick={() => onDuplicate(selected.id)}><Copy size={15} /></button>
      <button type="button" aria-label="レイヤーを削除" title="削除" onClick={() => onRemove(selected.id)}><Trash2 size={15} /></button>
    </div>}
    {imageError && <p className={styles.error} role="alert">{imageError}</p>}
    {layers.length === 0 && <p className={styles.layerHint}>文字や画像を追加</p>}
  </>;
}

export function LayerAppearance({ layer, loading, onTextChange, onLoadImage }: {
  layer: EmojiLayer; loading: boolean; onTextChange: (change: Partial<TextAppearance & { text: string }>) => void;
  onLoadImage: (file?: File, replaceId?: string) => void;
}) {
  if (layer.kind === "text") return <TextSettings layer={layer} onChange={onTextChange} />;
  return <label className={styles.upload}>
    <ImagePlus size={24} /><span>{loading ? "読み込み中…" : "画像を変更"}</span><small>PNG・JPEG・WebP / 5 MBまで</small>
    <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="選択レイヤーの画像を変更" disabled={loading} onChange={event => { onLoadImage(event.target.files?.[0], layer.id); event.target.value = ""; }} />
  </label>;
}

function TextSettings({ layer, onChange }: { layer: TextLayer; onChange: (change: Partial<TextAppearance & { text: string }>) => void }) {
  return <>
    <label className={styles.field}><span>文字 <small>{layer.text.length}/40</small></span>
      <textarea rows={2} maxLength={40} value={layer.text} placeholder="文字を入力" onChange={event => onChange({ text: event.target.value })} />
    </label>
    <FontPicker value={layer.font} text={layer.text} onChange={font => onChange({ font })} />
    <div className={styles.appearance}>
      <Slider label="字間" value={layer.letterSpacing ?? 0} min={-30} max={100} unit="%" onChange={letterSpacing => onChange({ letterSpacing })} />
      <Slider label="行間" value={layer.lineSpacing ?? 0} min={-50} max={150} unit="%" onChange={lineSpacing => onChange({ lineSpacing })} />
    </div>
    <ColorPalette label="文字色" value={layer.color} onChange={color => onChange({ color })} />
    <div className={styles.appearance}>
      <ColorPalette label="縁の色" value={layer.outlineColor} onChange={outlineColor => onChange({ outlineColor })} />
      <Slider label="縁の太さ" value={layer.outline} min={0} max={24} onChange={outline => onChange({ outline })} />
    </div>
    <div className={`${styles.appearance} ${styles.shadowSettings}`}>
      <ColorPalette label="影の色" value={layer.shadowColor} onChange={shadowColor => onChange({ shadowColor })} />
      <Slider label="影の距離" value={layer.shadow} min={0} max={24} onChange={shadow => onChange({ shadow })} />
      <Slider label="ぼかし" value={layer.shadowBlur} min={0} max={24} onChange={shadowBlur => onChange({ shadowBlur })} />
    </div>
  </>;
}
