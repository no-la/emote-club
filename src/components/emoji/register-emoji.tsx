"use client";

import { useEffect, useRef, useState, useImperativeHandle, type Ref } from "react";
import { X } from "lucide-react";
import { emojiName, type RegistrationResult } from "@/lib/emoji/registration";
import { guildUrl, type WorkshopIdentity } from "@/lib/emoji/shared";
import { WorkshopRequestError, workshopRequest } from "./workshop-account";
import { uploadSignedImage, type AssetUploadTicket } from "@/lib/emoji/direct-upload";
import styles from "./register-emoji.module.css";

type Submission = { requestId: string; name: string };
export type RegisterEmojiHandle = { open: () => void };
export default function RegisterEmoji({ identity, image, controlRef }: { controlRef?: Ref<RegisterEmojiHandle>; identity: WorkshopIdentity | null; image?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const uploadTicket = useRef<(AssetUploadTicket & { name: string }) | null>(null);
  const [canCancelUnstarted, setCanCancelUnstarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [outcome, setOutcome] = useState<RegistrationResult | null>(null);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const [bot, setBot] = useState<{ installed: boolean; inviteUrl: string | null } | null>(null);
  const [botError, setBotError] = useState("");
  const [botRevision, setBotRevision] = useState(0);
  const guildId = identity?.guild?.id;
  const userId = identity?.user?.id;
  useEffect(() => {
    if (!opened || !guildId || !userId) return;
    let controller: AbortController | undefined;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      setBot(null); setBotError("");
      void workshopRequest<{ installed: boolean; inviteUrl: string | null }>(guildUrl("/api/emoji/bot", guildId), { signal }).then(value => {
        if (!signal.aborted) setBot(value);
      }).catch(cause => {
        if (!signal.aborted) setBotError(cause instanceof Error ? cause.message : "Botの参加状況を確認できません。");
      });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { controller?.abort(); window.removeEventListener("focus", refresh); };
  }, [opened, guildId, userId, botRevision]);
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
      uploadTicket.current = null;
      setPreview(image || null); setOutcome(null); setError("");
      try {
        const previous = JSON.parse(sessionStorage.getItem(key) || "null") as Submission | null;
        if (previous && typeof previous.requestId === "string" && typeof previous.name === "string") {
          setSubmission(previous); setName(previous.name); setPreview(null);
        }
      } catch { /* Ignore inaccessible storage. */ }
    }
    setBot(null); setBotError(""); setOpened(true);
    dialog.current?.showModal();
  }
  useImperativeHandle(controlRef, () => ({ open }));
  async function submit() {
    if (inFlight.current || !allowed || !bot?.installed || !preview || !emojiName(name) || submission) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const blob = await (await fetch(preview)).blob();
      if (!uploadTicket.current || uploadTicket.current.name !== name) {
        const ticket = await workshopRequest<AssetUploadTicket>(guildUrl("/api/emoji/register/upload", guildId || ""), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
        uploadTicket.current = { ...ticket, name };
      }
      await uploadSignedImage(uploadTicket.current, blob);
      const attempt = { requestId: uploadTicket.current.id, name };
      setSubmission(attempt); remember(attempt); setCanCancelUnstarted(false);
      const value = await workshopRequest<RegistrationResult>(guildUrl("/api/emoji/register", guildId || ""), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: attempt.requestId }) });
      accept(value as RegistrationResult);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "登録結果を確認できません。結果を再確認してください。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function check() {
    if (!submission || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { accept(await workshopRequest<RegistrationResult>(guildUrl(`/api/emoji/register?requestId=${encodeURIComponent(submission.requestId)}`, identity?.guild?.id || ""))); }
    catch (cause) { setCanCancelUnstarted(cause instanceof WorkshopRequestError && cause.status === 404); setError(cause instanceof WorkshopRequestError ? cause.message : "結果を取得できません。少し待って再確認してください。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function cancelUnstarted() {
    if (!submission || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { accept(await workshopRequest<RegistrationResult>(guildUrl("/api/emoji/register/cancel", guildId || ""), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submission) })); setCanCancelUnstarted(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "状態を確認できません。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="register-title" onClose={() => {
      setOpened(false);
      if (outcome?.status === "succeeded") {
        setSubmission(null); uploadTicket.current = null; setOutcome(null); setError(""); setName(""); setPreview(null);
      }
    }} onCancel={event => { if (busy) event.preventDefault(); }}>
      <header><h2 id="register-title">サーバーに絵文字を追加</h2><button type="button" aria-label="登録画面を閉じる" disabled={busy} onClick={() => dialog.current?.close()}><X size={20} /></button></header>
      <p className={styles.destination}>登録先：{identity?.guild?.name || "ログイン後に表示されます"}</p>
      {identity?.user && guildId && <section className={styles.botSetup} aria-label="Botの参加状況">
        {!bot && !botError && <p role="status">Botの参加状況を確認中…</p>}
        {botError && <p role="alert">{botError}</p>}
        {bot?.installed === false && <>
          <p>このサーバーに絵文字を追加するには、Botの導入が必要です。</p>
          {bot.inviteUrl ? <a href={bot.inviteUrl} target="_blank" rel="noopener noreferrer">Botを追加</a> : <p>サーバー管理者にBotの追加を依頼してください。</p>}
        </>}
        {(botError || bot?.installed === false) && <button type="button" onClick={() => setBotRevision(value => value + 1)}>参加状況を再確認</button>}
      </section>}
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
          {unresolved && canCancelUnstarted && <button type="button" disabled={busy} onClick={() => void cancelUnstarted()}>未送信の登録を取り消す</button>}
          {unresolved ? <button type="button" disabled={busy || !allowed} onClick={() => void check()}>{busy ? "処理中…" : "登録結果を確認"}</button> : outcome?.status === "succeeded" ? null : submission ? <button type="button" onClick={() => { setSubmission(null); uploadTicket.current = null; setOutcome(null); setError(""); setPreview(image || null); }}>内容を見直す</button> : <button type="submit" disabled={busy || !allowed || !bot?.installed || !emojiName(name) || !preview}>{busy ? "登録中…" : "この内容で追加"}</button>}
          <button type="button" disabled={busy} onClick={() => dialog.current?.close()}>閉じる</button>
        </div>
      </form>
    </dialog>
  </>;
}
