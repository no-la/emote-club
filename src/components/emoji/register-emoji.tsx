"use client";

import { useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { emojiName, type RegistrationResult } from "@/lib/emoji/registration";
import { guildUrl, type WorkshopIdentity } from "@/lib/emoji/shared";
import { WorkshopRequestError, workshopRequest } from "./workshop-account";
import styles from "./register-emoji.module.css";

type Submission = { requestId: string; name: string };
export default function RegisterEmoji({ identity, image, canExport }: { identity: WorkshopIdentity | null; image?: string; canExport: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [outcome, setOutcome] = useState<RegistrationResult | null>(null);
  const [error, setError] = useState("");
  const key = `emoji-registration:${identity?.guild?.id}:${identity?.user?.id}`;
  const allowed = !!identity?.registrationConfigured && !!identity.user && !!identity.guild?.canCreateEmoji;
  const reason = !identity?.user ? "Discordにログインすると登録できます。" : !identity.guild ? "上のメニューからサーバーを選んでください。" : !identity.guild.canCreateEmoji ? "登録にはサーバーの「絵文字を作成」権限が必要です。" : !identity.registrationConfigured ? "サーバーへの登録は準備中です。" : "";
  const unresolved = !!submission && outcome?.status !== "succeeded" && outcome?.status !== "failed";
  function remember(value: Submission | null) {
    try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* DB also prevents duplicate sends. */ }
  }
  function accept(value: RegistrationResult) {
    setOutcome(value);
    if (value.status === "failed" || value.status === "succeeded") remember(null);
  }
  function open() {
    if (!submission) {
      setPreview(image || null); setOutcome(null); setError("");
      try {
        const previous = JSON.parse(sessionStorage.getItem(key) || "null") as Submission | null;
        if (previous && typeof previous.requestId === "string" && typeof previous.name === "string") {
          setSubmission(previous); setName(previous.name); setPreview(null);
        }
      } catch { /* Ignore inaccessible storage. */ }
    }
    dialog.current?.showModal();
  }
  async function submit() {
    if (inFlight.current || !allowed || !preview || !emojiName(name) || submission) return;
    const attempt = { requestId: crypto.randomUUID(), name };
    inFlight.current = true; setBusy(true); setError("");
    try {
      const blob = await (await fetch(preview)).blob();
      const form = new FormData(); form.set("file", blob, "emoji.png"); form.set("name", name); form.set("requestId", attempt.requestId);
      setSubmission(attempt); remember(attempt);
      const response = await fetch(guildUrl("/api/emoji/register", identity?.guild?.id || ""), { method: "POST", body: form, cache: "no-store", signal: AbortSignal.timeout(55_000) });
      const value = await response.json();
      if (!response.ok) {
        // Named validation/authorization/reservation errors happen before Discord is mutated.
        if (value.code && value.code !== "unavailable") { setSubmission(null); remember(null); }
        throw new Error(value.error || "登録結果を確認できません。再送せず結果を確認してください。");
      }
      accept(value as RegistrationResult);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "登録結果を確認できません。結果を再確認してください。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function check() {
    if (!submission || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { accept(await workshopRequest<RegistrationResult>(guildUrl(`/api/emoji/register?requestId=${encodeURIComponent(submission.requestId)}`, identity?.guild?.id || ""))); }
    catch (cause) { setError(cause instanceof WorkshopRequestError ? cause.message : "結果を取得できません。少し待って再確認してください。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <>
    <button type="button" className={styles.open} disabled={!canExport && !submission} onClick={open}><Send size={15} />サーバーに追加</button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="register-title" onClose={() => {
      if (outcome?.status === "succeeded") {
        setSubmission(null); setOutcome(null); setError(""); setName(""); setPreview(null);
      }
    }} onCancel={event => { if (busy) event.preventDefault(); }}>
      <header><h2 id="register-title">サーバーに絵文字を追加</h2><button type="button" aria-label="登録画面を閉じる" disabled={busy} onClick={() => dialog.current?.close()}><X size={20} /></button></header>
      <p className={styles.destination}>登録先：{identity?.guild?.name || "ログイン後に表示されます"}</p>
      {preview && <div className={styles.preview} role="img" aria-label="登録する絵文字" style={{ backgroundImage: `url("${preview}")` }} />}
      {!preview && submission && <p>前回の登録結果を確認します：{submission.name}</p>}
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label htmlFor="discord-emoji-name">絵文字の名前</label>
        <input id="discord-emoji-name" value={name} onChange={event => setName(event.target.value)} disabled={!!submission || busy} placeholder="erai" minLength={2} maxLength={32} pattern="[A-Za-z0-9_]{2,32}" required autoComplete="off" aria-describedby="emoji-name-help" />
        <small id="emoji-name-help">半角英数字・アンダースコア、2〜32文字</small>
        {reason && <p className={styles.notice}>{reason}</p>}
        {!identity?.user && identity?.configured && <a href="/api/auth/discord" target="_blank" rel="noopener">Discordでログイン</a>}
        {outcome && <p role="status" className={outcome.status === "succeeded" ? styles.success : styles.notice}>{outcome.message}{outcome.retryAfter > 0 ? `（応答時点の待ち時間：約${outcome.retryAfter}秒）` : ""}</p>}
        {outcome?.status === "succeeded" && <code>:{outcome.name}:</code>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {unresolved && !busy && <p className={styles.notice}>結果の確認では画像を再送しません。同じ名前の登録をやり直す前に、Discord側の一覧も確認してください。</p>}
        <div className={styles.actions}>
          {unresolved ? <button type="button" disabled={busy || !allowed} onClick={() => void check()}>{busy ? "処理中…" : "登録結果を確認"}</button> : outcome?.status === "succeeded" ? null : submission ? <button type="button" onClick={() => { setSubmission(null); setOutcome(null); setError(""); setPreview(image || null); }}>内容を見直す</button> : <button type="submit" disabled={busy || !allowed || !emojiName(name) || !preview}>{busy ? "登録中…" : "この内容で追加"}</button>}
          <button type="button" disabled={busy} onClick={() => dialog.current?.close()}>閉じる</button>
        </div>
      </form>
    </dialog>
  </>;
}
