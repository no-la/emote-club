"use client";
import { useEffect, useId, useRef, type RefObject } from "react";
import { ChevronDown, X } from "lucide-react";
import styles from "./emoji-editor.module.css";

export function Slider({ label, value, min, max, step = 1, unit = "", onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void;
}) {
  return <label className={styles.slider}><span>{label}<output>{Math.round(value * 100) / 100}{unit}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
  </label>;
}

export function positionPopover(anchor: HTMLElement, popup: HTMLElement | null) {
  if (!popup) return;
  const rect = anchor.getBoundingClientRect();
  popup.style.left = `${Math.max(8, Math.min(rect.right - 236, window.innerWidth - 244))}px`;
  popup.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 230))}px`;
}
export function usePopoverDismiss(popup: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const close = (event: Event) => {
      if (event.target instanceof Node && popup.current?.contains(event.target)) return;
      popup.current?.hidePopover();
    };
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [popup]);
}
const swatches = ["#ffffff", "#ffe477", "#ff8a9e", "#a7e4df", "#86baff", "#292329"];

export function ColorPalette({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  usePopoverDismiss(popup);
  return <div className={styles.colorRow}>
    <span>{label}</span>
    <button type="button" className={styles.colorTrigger} aria-label={`${label}を選ぶ`} title={`${label}: ${value}`} popoverTarget={id} onClick={event => positionPopover(event.currentTarget, popup.current)}>
      <span style={{ backgroundColor: value }} /><ChevronDown size={12} />
    </button>
    <div ref={popup} id={id} popover="auto" className={styles.popover} role="dialog" aria-label={`${label}のパレット`}>
      <div className={styles.popoverHeader}><strong>{label}</strong><button type="button" aria-label={`${label}のパレットを閉じる`} popoverTarget={id} popoverTargetAction="hide"><X size={15} /></button></div>
      <div className={styles.swatchChoices}>{swatches.map(color => <button key={color} type="button" title={color} aria-label={`${label} ${color}`} aria-pressed={value.toLowerCase() === color} style={{ backgroundColor: color }} onClick={() => { onChange(color); popup.current?.hidePopover(); }} />)}</div>
      <label className={styles.nativeColor}>任意の色 <input type="color" aria-label={`その他の${label}`} value={value} onChange={event => onChange(event.target.value)} /><span>{value.toUpperCase()}</span></label>
    </div>
  </div>;
}
