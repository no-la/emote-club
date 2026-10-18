"use client";

import { ArrowUp, ArrowDown, Plus, X } from "lucide-react";
import { useId, useRef } from "react";
import { EFFECTS, type EffectId, type EffectStack } from "@/lib/emoji/model";
import { ColorPalette, Slider, positionPopover, usePopoverDismiss } from "./editor-controls";
import styles from "./emoji-editor.module.css";

export default function EffectEditor({ value, label, onChange }: { value: EffectStack; label: string; onChange: (next: EffectStack) => void }) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  usePopoverDismiss(menu);
  function configure<K extends EffectId>(id: K, change: Partial<EffectStack["effectSettings"][K]>) {
    onChange({ effects: value.effects, effectSettings: { ...value.effectSettings, [id]: { ...value.effectSettings[id], ...change } } });
  }
  function move(id: EffectId, delta: number) {
    const effects = [...value.effects];
    const index = effects.indexOf(id), target = index + delta;
    if (index < 0 || target < 0 || target >= effects.length) return;
    [effects[index], effects[target]] = [effects[target], effects[index]];
    onChange({ effects, effectSettings: value.effectSettings });
  }
  return <>
    <div className={styles.effectTools}>
      <h2>{label}</h2>
      {value.effects.length > 1 && <button type="button" aria-label="効果をすべて解除" title="効果をすべて解除" onClick={() => onChange({ effects: [], effectSettings: value.effectSettings })}><X size={14} /></button>}
      <button type="button" aria-label="効果を追加" disabled={value.effects.length === Object.keys(EFFECTS).length} popoverTarget={id} onClick={event => positionPopover(event.currentTarget, menu.current)}><Plus size={14} />追加</button>
      <div ref={menu} id={id} popover="auto" className={`${styles.popover} ${styles.effectMenu}`} role="dialog" aria-label="追加する効果">
        {(Object.keys(EFFECTS) as EffectId[]).filter(effect => !value.effects.includes(effect)).map(effect => <button key={effect} type="button" onClick={() => { onChange({ effects: [...value.effects, effect], effectSettings: value.effectSettings }); menu.current?.hidePopover(); }}>{EFFECTS[effect].name}</button>)}
      </div>
    </div>
    {value.effects.map((effect, index) => <section key={effect} className={styles.effectSettings} aria-label={`${EFFECTS[effect].name}の設定`}>
      <header><h3>{EFFECTS[effect].name}</h3><div className={styles.effectOrder}>
        <button type="button" aria-label={`${EFFECTS[effect].name}を上へ`} disabled={index === 0} onClick={() => move(effect, -1)}><ArrowUp size={14} /></button>
        <button type="button" aria-label={`${EFFECTS[effect].name}を下へ`} disabled={index === value.effects.length - 1} onClick={() => move(effect, 1)}><ArrowDown size={14} /></button>
        <button type="button" aria-label={`${EFFECTS[effect].name}を解除`} title="解除" onClick={() => onChange({ effects: value.effects.filter(id => id !== effect), effectSettings: value.effectSettings })}><X size={14} /></button>
      </div></header>
      <Slider label={EFFECTS[effect].control} value={value.effectSettings[effect].strength} min={0} max={24} onChange={strength => configure(effect, { strength })} />
      {(effect === "wave" || effect === "rgb" || effect === "shadow") && <Slider label="向き" unit="°" value={value.effectSettings[effect].angle} min={0} max={360} onChange={angle => configure(effect, { angle })} />}
      {effect === "shadow" && <>
        <Slider label="ぼかし" value={value.effectSettings.shadow.blur} min={0} max={24} onChange={blur => configure("shadow", { blur })} />
        <div className={styles.effectColor}><ColorPalette label="影の色" value={value.effectSettings.shadow.color} onChange={color => configure("shadow", { color })} /></div>
      </>}
      {effect === "glow" && <div className={styles.effectColor}><ColorPalette label="光の色" value={value.effectSettings.glow.color} onChange={color => configure("glow", { color })} /></div>}
      {effect === "wave" && <Slider label="波の位置" value={value.effectSettings.wave.phase} min={0} max={6.28} step={0.05} onChange={phase => configure("wave", { phase })} />}
    </section>)}
  </>;
}
