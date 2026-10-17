"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { guildUrl, type WorkshopIdentity } from "@/lib/emoji/shared";
import styles from "./shared-assets.module.css";

export class WorkshopRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function workshopRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store" });
  const value = await response.json();
  if (!response.ok) throw new WorkshopRequestError(value.error || "処理できませんでした。もう一度お試しください。", response.status);
  return value as T;
}
const loginErrors: Record<string, string> = {
  cancelled: "ログインをキャンセルしました。", not_member: "このサーバーのメンバーだけが共有素材を利用できます。",
  invalid_state: "ログインの有効期限が切れました。もう一度お試しください。", oauth_failed: "ログインできませんでした。もう一度お試しください。",
  discord_unavailable: "Discordへ接続できません。少し待って再試行してください。",
};
export function useWorkshopIdentity() {
  const [identity, setIdentity] = useState<WorkshopIdentity | null>(null);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++sequence.current;
    const guildId = sessionStorage.getItem("emote-club-guild") || "";
    let notice = "";
    try {
      let next: WorkshopIdentity;
      try { next = await workshopRequest<WorkshopIdentity>(guildId ? guildUrl("/api/auth/session", guildId) : "/api/auth/session"); }
      catch (e) {
        if (!(e instanceof WorkshopRequestError) || ![400,403].includes(e.status)) throw e;
        // Leaving a guild must not lock the user out of choosing another one.
        if (version !== sequence.current) return;
        sessionStorage.removeItem("emote-club-guild"); notice = e.message;
        next = await workshopRequest<WorkshopIdentity>("/api/auth/session");
      }
      if (version !== sequence.current) return;
      const url = new URL(window.location.href);
      const code = url.searchParams.get("auth_error");
      if (code) { notice = loginErrors[code] || loginErrors.oauth_failed; url.searchParams.delete("auth_error"); window.history.replaceState(window.history.state,"",url); }
      setIdentity(next); setError(notice);
    } catch (e) {
      if (version !== sequence.current) return;
      if (e instanceof WorkshopRequestError && e.status === 401) setIdentity(previous => previous ? {...previous,user:null,guild:null} : null);
      setError(e instanceof Error ? e.message : "ログイン状態を取得できませんでした。");
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => { void refresh(); },0);
    const focus = () => {void refresh();};
    window.addEventListener("focus",focus);
    return () => {clearTimeout(initial); window.removeEventListener("focus",focus);};
  },[refresh]);
  return {identity,error,refresh,setError};
}

export function WorkshopAccount({ identity, error, onRefresh, onError }: { identity: WorkshopIdentity | null; error: string; onRefresh: () => Promise<void>; onError: (value: string) => void }) {
  const [busy, setBusy] = useState(false);
  return <div className={styles.account}>
    {error && <button type="button" className={styles.accountError} title={error} onClick={() => { void onRefresh(); }}>ログイン状態を再確認</button>}
    {identity?.user ? <>
      <GuildSelector userId={identity.user.id} guildId={identity.guild?.id || ""} onRefresh={onRefresh} onError={onError} />
      <span title={identity.user.name}>{identity.user.name}</span>
      <button type="button" aria-label="ログアウト" title="ログアウト" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await workshopRequest("/api/auth/logout", { method: "POST" }); await onRefresh(); }
        catch (error) { onError(error instanceof Error ? error.message : "ログアウトできませんでした。"); }
        finally { setBusy(false); }
      }}><LogOut size={15} /></button>
    </> : identity?.configured ? <a href="/api/auth/discord" target="_blank" rel="noopener" title="別タブでログインします。編集内容はこのタブに残ります。"><LogIn size={15} />Discordでログイン</a> : <span className={styles.unavailable} title="Discord認証の接続設定が必要です">{identity ? "ログイン準備中" : "確認中…"}</span>}
  </div>;
}

type GuildOption = { id: string; name: string; inviteUrl: string | null };
function GuildSelector({userId, guildId, onRefresh, onError}: {userId:string; guildId:string; onRefresh:()=>Promise<void>; onError:(message:string)=>void}) {
  const [guilds,setGuilds] = useState<GuildOption[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [revision,setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    workshopRequest<{guilds:GuildOption[]}>("/api/auth/guilds",{signal:abort.signal}).then(data => {setGuilds(data.guilds);setError("");}).catch(e => {if(!abort.signal.aborted)setError(e.message);});
    return () => abort.abort();
  },[userId,revision]);
  const selected = guilds.find(g => g.id===guildId);
  return <>
    <select aria-label="Discordサーバー" disabled={busy} value={guildId} onChange={async e => {
      const id = e.target.value; sessionStorage.setItem("emote-club-guild",id); setBusy(true);
      try {await onRefresh();} catch(e) {onError(e instanceof Error ? e.message : "サーバーを変更できませんでした。");} finally {setBusy(false);}
    }}>
      <option value="">サーバーを選択</option>
      {guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
    </select>
    <button type="button" title={error || "サーバー一覧を更新"} onClick={()=>setRevision(n=>n+1)}>{error ? "一覧を再取得" : "更新"}</button>
    {selected?.inviteUrl && <a href={selected.inviteUrl} target="_blank" rel="noopener noreferrer" title="絵文字を直接追加するためのBotを導入します">Botを追加</a>}
  </>;
}
