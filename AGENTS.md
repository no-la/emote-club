# 開発方針

## 作業の進め方

- 会話・作業報告は日本語で行う。
- 既存の変更を確認してから作業し、無関係な変更を上書き・破棄しない。
- ユーザーが依頼した範囲を実装・検証まで進める。通常の編集やコミットのたびに確認を求めない。
- 未接続のAPIや保存処理を、成功したように見せる仮実装で置き換えない。
- 仕様・構成が変わったら関連ドキュメントも更新する。絵文字工房の仕様・フォント出典は `docs/emoji-workshop.md` を参照する。

## 構成

- Next.js App Router / React / TypeScript / CSS Modules、PixiJSはブラウザ専用。
- `/` がエディタ。ブログ・RSS・記事機能は含めない。
- パッケージ管理はpnpm。デプロイナウ向けpackage-lock.jsonも依存更新時に同期する。
- Discord認証はNext.js。すべての共有APIで明示されたguildIdへの所属を検証し、更新時はOriginと最新の権限を再確認する。
- Supabaseのservice keyとDiscordの秘密情報はサーバー限定。認証バイパスや公開Storageを作らない。
- セットアップと運用は `docs/emoji-sharing-setup.md`。フォント出典は `docs/emoji-workshop.md` と各フォントのライセンス。

## 検証

- 変更に応じて型チェック、lint、本番ビルドを実行する。pnpm未導入時は `npx --yes pnpm@10` で代用できる。

  ```sh
  pnpm exec tsc --noEmit
  pnpm lint
  pnpm test:emoji
  SITE_URL=http://localhost:3000 pnpm build
  ```

- `SITE_URL` はローカル・公開先ごとに設定する。
- 開発サーバーとビルドは同じ `.next` を同時更新しないようにする。停止した開発サーバーは検証後に再開する。
- UI変更は利用可能なブラウザで実際に操作し、対象画面幅、キーボード操作、スクロールを確認する。絵文字工房は現在PCの操作性を先に整える段階なので、モバイルの再設計・検証は後工程とする。PNG出力に関わる変更は保存画像も確認する。
- 認証・画像共有の変更では `test:emoji` で権限・入力検証・非公開DB・容量制限を確認する。実接続が未設定の場合は実ログインやSupabaseへの保存を確認済みとしない。
- 認証ルートの変更は本番ビルド後に `pnpm test:emoji:http` でHTTP経由の拒否条件・OAuth state/PKCEも検証する。テストは一時ポートのNext.jsプロセスだけにダミーの接続設定を渡し、実際の `.env.local` は変更しない。
- 検証用のスクリーンショットや一時ファイル、秘密情報、ローカル環境設定はコミットしない。生成物は意図した変更だけを含める。
- 検証できなかった事項や既存警告は報告し、未確認のものを確認済みとしない。

## コミット

- Conventional Commits形式を使用する: `<type>(<scope>): <変更内容>`。scopeは必要な場合に付け、説明は日本語・英語のどちらでもよい。
- 主なtypeは `feat` / `fix` / `refactor` / `docs` / `style` / `test` / `chore`。`style` はコード整形に使い、画面の挙動・見た目の変更には内容に合う `feat` / `fix` を使う。
- ひとつのコミットはひとつの目的にまとめ、機能と無関係な修正・文書整備は分ける。依存する実装・型・アセット・ライセンスは揃えて含める。
- 作業中も、実装がまとまり検証できた単位でコミットを積む。未完成の変更をまとめて長期間残さない。
- コミット前にステージした差分と `git diff --check` を確認する。外部配布のライセンス文書は原文の改行・空白を保持し、その範囲の警告はソースコードと区別して扱う。ユーザーの既存コミットは依頼なしに書き換えない。
- push・マージ・デプロイは、ユーザーの指示があるときに行う。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
