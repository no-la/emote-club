"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { FONTS, FONT_FAMILIES, type FontId } from "@/lib/emoji/model";
import { loadFont } from "@/lib/emoji/fonts";
import styles from "./font-picker.module.css";

function FontOption({ id, text, selected, onSelect }: { id: FontId; text: string; selected: boolean; onSelect: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"waiting" | "ready" | "error">("waiting");
  useEffect(() => {
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void loadFont(id).then(() => { if (active) setStatus("ready"); }).catch(() => { if (active) setStatus("error"); });
    });
    if (ref.current) observer.observe(ref.current);
    return () => { active = false; observer.disconnect(); };
  }, [id, attempt]);
  return <button ref={ref} type="button" aria-pressed={selected} onClick={() => { if (status === "error") { setStatus("waiting"); setAttempt(n => n + 1); } else onSelect(); }} disabled={status === "waiting"}>
    <span className={styles.name}>{FONTS[id].name}{selected && <Check size={16} />}</span>
    <span className={styles.sample} style={status === "ready" ? { fontFamily: FONT_FAMILIES[id] } : undefined}>
      {status === "ready" ? text.trim() || "えらい" : status === "error" ? "再読み込みする" : "読み込み中…"}
    </span>
  </button>;
}

export default function FontPicker({ value, text, onChange }: { value: FontId; text: string; onChange: (id: FontId) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  function close() { dialog.current?.close(); setOpen(false); }
  return <div className={styles.picker}>
    <span className={styles.label}>フォント</span>
    <button className={styles.trigger} type="button" aria-haspopup="dialog" onClick={() => { setQuery(""); setOpen(true); dialog.current?.showModal(); }}>
      <span>{FONTS[value].name}</span><ChevronDown size={16} />
    </button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="font-picker-title" onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
      <header><h2 id="font-picker-title">フォントを選ぶ</h2><button type="button" aria-label="フォント一覧を閉じる" onClick={close}><X size={20} /></button></header>
      <input autoFocus type="search" aria-label="フォント名で検索" placeholder="フォント名で検索" value={query} onChange={event => setQuery(event.target.value)} />
      <div className={styles.list}>
        {open && (Object.keys(FONTS) as FontId[]).filter(id => FONTS[id].name.toLowerCase().includes(query.trim().toLowerCase())).map(id =>
          // close() reads the dialog ref only when this selection callback runs.
          // eslint-disable-next-line react-hooks/refs
          <FontOption key={id} id={id} text={text} selected={id === value} onSelect={() => { onChange(id); close(); }} />)}
        {query && !(Object.keys(FONTS) as FontId[]).some(id => FONTS[id].name.toLowerCase().includes(query.trim().toLowerCase())) && <p>該当するフォントがありません</p>}
      </div>
    </dialog>
  </div>;
}
