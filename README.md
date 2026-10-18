# Emote Club

Discordサーバーのみんなで絵文字を作り、素材を共有するWebアプリ。

- ブラウザ内のレイヤーエディタ、フォント・エフェクト、512×512透過PNG保存・Discord登録用128×128出力
- Discordログイン後に参加サーバーを選択。共有素材は最初から一覧表示
- ローカル画像・現在のキャンバスをサーバー内の共有素材として保存
- 「絵文字を作成」権限を持つメンバーが、Bot経由でDiscordへ直接登録

## 開発

Node.js 22.13以上。`pnpm install --frozen-lockfile` → `.env.example` を `.env.local` にコピーして設定 → `pnpm dev`。
`pnpm typecheck`、`pnpm lint`、`pnpm test:emoji`、`pnpm build`、`pnpm test:emoji:http` で検証。

Next.js 16 / React / TypeScript / PixiJS / sharp。Discord OAuthとAPIはNext.js、DBと非公開画像はSupabase、公開先はロリポップ！デプロイナウ。

[接続・公開・運用手順](docs/emoji-sharing-setup.md) / [エディタ・フォント出典](docs/emoji-workshop.md)

元実装: [hukidamari/hukidamari-hub](https://github.com/hukidamari/hukidamari-hub)、`e041a9b` から絵文字機能を抽出。フォントは各 `public/fonts` のライセンスに従います。

## コントリビューション

不具合報告・改善提案のIssue、修正のPull Requestを歓迎します。開発・検証手順は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。大きな機能追加や仕様変更は、実装前にIssueで相談してください。

## ライセンス

コード本体は [MIT License](LICENSE) で公開しています。同梱フォントはMITライセンスの対象に含まず、各 `public/fonts/` ディレクトリのライセンス・著作権表記に従います。利用する依存ライブラリにも、それぞれのライセンスが適用されます。
