# コントリビューション

IssueとPull Requestを歓迎します。日本語・英語のどちらでも構いません。大きな機能追加や仕様変更は、先にIssueで相談してください。

## 不具合報告・改善提案

不具合は再現手順、期待した動作、実際の動作、ブラウザ・OSを記載してください。画面の問題はスクリーンショットも役立ちます。Cookie、トークン、環境変数、非公開サーバーの情報は投稿しないでください。改善提案には、困っていることや使いたい場面を添えてください。

## 開発環境

Node.js 22.13以上とpnpmを使用します。

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Discord認証・素材共有・絵文字登録の検証には、自分の開発用Discord ApplicationとSupabaseプロジェクトを使用してください。設定手順は [接続・運用手順](docs/emoji-sharing-setup.md) を参照してください。秘密情報や `.env.local` はコミットしないでください。

## Pull Request

変更の目的、変更後の動作、確認した内容を記載してください。UI変更にはPC・スマホ表示のスクリーンショットを添えてください。関連Issueがある場合はリンクしてください。

変更に応じて次の確認を実施します。ビルド前には開発サーバーを停止し、同じ `.next` を同時更新しないでください。

```sh
pnpm lint
pnpm test:emoji
SITE_URL=http://localhost:3000 pnpm build
pnpm test:emoji:http
```

本番ビルドにはTypeScriptの型検証も含まれます。認証・権限・画像保存に関わる変更では、関連する拒否条件のテストも更新してください。動作確認できなかった内容はPRに明記してください。

依存関係を変更する場合は `pnpm-lock.yaml` と、デプロイ用の `package-lock.json` を同期してください。コミットメッセージは `fix: ...` や `feat: ...` などのConventional Commits形式を使用します。

## ライセンス

コード本体への貢献は、このプロジェクトの [MIT License](LICENSE) の下で提供してください。第三者のコードや素材を追加する場合は、その出典とライセンスを明記し、必要な著作権表記を保持してください。同梱フォントには各フォントのライセンスが適用されます。
