"use client";

import { useCallback, useEffect, useRef, useState, useImperativeHandle, type Ref } from "react";
import MobilePanel, { PanelBody, type MobilePanelControls } from "./mobile-panel";
import Image from "next/image";
import { Images, Plus, RefreshCw, X, Camera, ImagePlus, MoreHorizontal } from "lucide-react";
import { assetName, guildUrl, type SharedAsset, type WorkshopIdentity } from "@/lib/emoji/shared";
import { reserveAssetUpload, sendAssetUpload, type AssetUploadTicket } from "@/lib/emoji/direct-upload";
import { prepareImage } from "@/lib/emoji/prepare-image";
import { workshopRequest } from "./workshop-account";
import styles from "./shared-assets.module.css";

type AssetPage = { assets: SharedAsset[]; nextOffset: number | null };
function AssetCard({ asset, busy, canAdd, onUse, onRename, onDelete }: { asset: SharedAsset; busy: boolean; canAdd: boolean; onUse: () => void; onRename: (name: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(asset.name);
  const [confirming, setConfirming] = useState(false);
  return <li className={styles.card}>
    <button type="button" className={styles.assetPreview} disabled={busy || !canAdd || asset.status !== "ready"} aria-label={`${asset.name}をエディタに追加`} onClick={onUse}>
      {asset.status === "ready" && asset.imageUrl ? <Image src={asset.imageUrl!} alt={asset.name} width={180} height={120} unoptimized /> : <span>{asset.status === "pending" ? "登録未完了" : "削除未完了"}</span>}
      {asset.status === "ready" && <span className={styles.addHint}><Plus size={14} />追加</span>}
    </button>
    {editing ? <form className={styles.rename} onSubmit={event => { event.preventDefault(); if (assetName(name)) { onRename(name.trim()); setEditing(false); } }}>
      <input autoFocus aria-label="新しい素材名" maxLength={80} value={name} onChange={event => setName(event.target.value)} />
      <button disabled={busy || !assetName(name)}>保存</button><button type="button" onClick={() => setEditing(false)}>取消</button>
    </form> : <strong title={asset.name}>{asset.name}</strong>}
    <small title={asset.ownerName}>{asset.ownerName}</small>
    {asset.canManage && <details className={styles.cardActions}><summary aria-label={`${asset.name}の管理`}><MoreHorizontal size={16} /></summary><div>
      {confirming ? <><span>削除しますか？</span><button type="button" disabled={busy} onClick={onDelete}>削除する</button><button type="button" onClick={() => setConfirming(false)}>取消</button></> : <>
        {asset.status === "ready" && <button type="button" disabled={busy} onClick={() => { setName(asset.name); setEditing(true); }}>名前を変更</button>}
        <button type="button" disabled={busy} onClick={() => setConfirming(true)}>{asset.status === "deleting" ? "削除を再試行" : "削除"}</button>
      </>}
    </div></details>}
  </li>;
}

export type SharedAssetsHandle = { shareCanvas: () => void };
export default function SharedAssets({ identity, identityError, canAdd, onUse, onRefreshIdentity, canvasImage, canvasName, controlRef, panelControls }: {
  controlRef?: Ref<SharedAssetsHandle>; panelControls: MobilePanelControls;
  identity: WorkshopIdentity | null; identityError: string; canAdd: boolean;
  onUse: (file: File) => Promise<void>; onRefreshIdentity: () => Promise<void>;
  canvasImage?: string; canvasName: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [assets, setAssets] = useState<SharedAsset[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const uploadInput = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const requestVersion = useRef(0);
  const operation = useRef(false);
  const uploadTicket = useRef<AssetUploadTicket | null>(null);
  const [uploadReserved, setUploadReserved] = useState(false);
  const connected = Boolean(identity?.user && identity.guild && identity.storageConfigured);
  const guildId = identity?.guild?.id || "";
  const load = useCallback(async (offset = 0) => {
    const version = ++requestVersion.current;
    setLoading(true); setError("");
    try {
      const page = await workshopRequest<AssetPage>(guildUrl(`/api/emoji/assets?offset=${offset}`, guildId));
      if (!active.current || version !== requestVersion.current) return;
      setAssets(previous => offset === 0 ? page.assets : [...previous, ...page.assets.filter(asset => !previous.some(item => item.id === asset.id))]);
      setNextOffset(page.nextOffset);
    } catch (error) { if (active.current && version === requestVersion.current) setError(error instanceof Error ? error.message : "素材を取得できませんでした。"); }
    finally { if (active.current && version === requestVersion.current) setLoading(false); }
  }, [guildId]);
  const invalidateLoad = useCallback(() => { requestVersion.current++; }, []);
  useEffect(() => {
    active.current = true;
    const initial = setTimeout(() => { if (connected) void load(); }, 0);
    const timer = setInterval(() => { if (connected && !operation.current && !document.hidden) void load(); }, 240_000);
    return () => { clearTimeout(initial); clearInterval(timer); active.current = false; invalidateLoad(); };
  }, [connected, load, invalidateLoad]);
  useEffect(() => {
    // Object URLs are external resources tied to the selected file lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function choose(selected: File, suggestedName: string) {
    const prepared = await prepareImage(selected, "image/webp");
    if (!active.current) return;
    uploadTicket.current = null; setUploadReserved(false);
    setUploadError(""); setFile(prepared); setName(suggestedName.slice(0, 80));
    dialog.current?.showModal();
  }
  function closeUpload() {
    dialog.current?.close(); setFile(null); setUploadError("");
    if (uploadInput.current) uploadInput.current.value = "";
  }
  async function run(action: () => Promise<void>, uploading = false) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(""); setUploadError(""); setNotice("");
    try { await action(); }
    catch (error) {
      if (active.current) (uploading ? setUploadError : setError)(error instanceof Error ? error.message : "処理できませんでした。");
    } finally { operation.current = false; if (active.current) setBusy(false); }
  }
  function shareCanvas() {
    if (!connected || busy || loading || !canvasImage) return;
    const captured = canvasImage;
    const capturedName = canvasName;
    void run(async () => {
      const blob = await (await fetch(captured)).blob();
      if (active.current) await choose(new File([blob], "canvas.png", { type: "image/png" }), capturedName || "作った絵文字");
    });
  }
  useImperativeHandle(controlRef, () => ({ shareCanvas }));
  return <MobilePanel className={styles.library} data-connected={connected} aria-labelledby="shared-assets-title" controls={panelControls}
    headingClassName={styles.libraryHeading} heading={<h2 id="shared-assets-title"><Images size={16} />共有素材</h2>} headingActions={
      <button type="button" aria-label="共有素材を更新" title="一覧を更新" disabled={!connected || busy || loading} onClick={() => void load()}><RefreshCw size={14} /></button>
    }>
    <p className={styles.subtitle}>選ぶとレイヤーに追加</p>
    <div className={styles.libraryTools}>
      <button type="button" className={styles.captureButton} disabled={!connected || !canvasImage || busy || loading} title="キャンバスの見た目を透明PNGとして共有" onClick={shareCanvas}><Camera size={14} />今の画像を共有</button>
      <label className={styles.uploadButton} aria-disabled={!connected || busy || loading}><ImagePlus size={14} />{busy ? "処理中…" : "画像を登録"}<input ref={uploadInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="共有する画像を選ぶ" disabled={!connected || busy || loading} onChange={event => {
        const selected = event.target.files?.[0]; event.target.value = "";
        if (selected) void run(() => choose(selected, selected.name.replace(/\.[^.]+$/, "")));
      }} /></label>
    </div>
    {!connected ? <PanelBody className={styles.empty}>
      {identityError ? <><p role="alert">{identityError}</p><button type="button" onClick={() => void onRefreshIdentity()}>再確認</button></> : !identity ? <p>ログイン状態を確認中…</p> : !identity.configured ? <p>共有素材は準備中です。</p> : !identity.user ? <><p>サーバーのみんなの素材を<br />ここから使えます。</p><a href="/api/auth/discord" target="_blank" rel="noopener">Discordでログイン</a></> : !identity.guild ? <p>上のメニューからサーバーを選んでください。</p> : <p>共有素材の保存先を準備中です。</p>}
    </PanelBody> : <>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {!canAdd && <p className={styles.notice}>読み込み完了、またはレイヤー削除後に追加できます。</p>}
      <PanelBody className={styles.content} aria-busy={loading || busy}>
        {!assets.length && <p className={styles.empty}>{loading ? "素材を読み込み中…" : error ? "一覧を更新して再試行してください。" : "まだ素材がありません。今の画像や手元の画像を共有してみましょう。"}</p>}
        <ul className={styles.grid}>{assets.map(asset => <AssetCard key={asset.id} asset={asset} busy={busy || loading} canAdd={canAdd} onUse={() => { void run(async () => {
          const response = await fetch(asset.imageUrl!, { cache: "no-store", credentials: "omit" });
          if (!response.ok) { const data = await response.json(); throw new Error(data.error || "画像を取得できませんでした。"); }
          const blob = await response.blob();
          if (active.current) { await onUse(new File([blob], `${asset.name}.webp`, { type: "image/webp" })); }
        }); }} onRename={name => { void run(async () => {
          const changed = await workshopRequest<{ asset: SharedAsset }>(guildUrl(`/api/emoji/assets/${asset.id}`, guildId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
          if (active.current) setAssets(previous => previous.map(item => item.id === asset.id ? changed.asset : item));
        }); }} onDelete={() => { void run(async () => {
          await workshopRequest(guildUrl(`/api/emoji/assets/${asset.id}`, guildId), { method: "DELETE" });
          if (active.current) { setAssets(previous => previous.filter(item => item.id !== asset.id)); await load(); }
        }); }} />)}</ul>
        {nextOffset !== null && <button type="button" className={styles.more} disabled={busy || loading} onClick={() => void load(nextOffset)}>{loading ? "読み込み中…" : "もっと見る"}</button>}
      </PanelBody>
    </>}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="share-image-title" onCancel={event => { if (busy) event.preventDefault(); }} onClose={() => { setFile(null); setUploadError(""); }}>
      <header><h2 id="share-image-title">画像を共有素材に登録</h2><button type="button" aria-label="素材の登録を閉じる" disabled={busy} onClick={closeUpload}><X size={20} /></button></header>
      <p className={styles.notice}>{identity?.guild?.name} のメンバーが利用できるようになります。</p>
      {preview && <div className={styles.uploadPreview} role="img" aria-label="共有する画像のプレビュー" style={{ backgroundImage: `url("${preview}")` }} />}
      <form className={styles.uploadForm} onSubmit={event => { event.preventDefault(); if (!file || !assetName(name)) return; void run(async () => {
        uploadTicket.current ??= await reserveAssetUpload(name.trim(), guildId);
        if (active.current) setUploadReserved(true);
        const { asset } = await sendAssetUpload(uploadTicket.current, file, guildId);
        if (!active.current) return;
        setAssets(previous => [asset, ...previous.filter(item => item.id !== asset.id)]); setNotice(`${asset.name}を共有しました`); closeUpload();
      }, true); }}>
        <label>素材名<input autoFocus required maxLength={80} aria-label="登録する素材名" value={name} onChange={event => setName(event.target.value)} disabled={busy || uploadReserved} /></label>
        <small>画像として共有します。文字やレイヤーの編集状態は含みません。</small>
        {uploadError && <p className={styles.error} role="alert">{uploadError}</p>}
        <div className={styles.uploadActions}><button type="button" disabled={busy} onClick={closeUpload}>取消</button><button disabled={busy || !file || !assetName(name)}>{busy ? "共有中…" : "サーバーに共有"}</button></div>
      </form>
    </dialog>
  </MobilePanel>;
}
