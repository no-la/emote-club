# Emote Club 接続・運用

## Discord

専用Discord Applicationを用意し、OAuth2 Redirectsに `SITE_URL/api/auth/discord/callback` を登録して保存します。ローカルは `http://localhost:3000/api/auth/discord/callback`。
`DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET`、Botの `DISCORD_BOT_TOKEN` をサーバー環境変数に設定します。Public Botを有効にし、Privileged Gateway Intentsは不要です。
ログインscopeはidentify/guilds。Bot導入リンクは選択したサーバーを固定し、Create Expressions (1<<43) のみ要求します。「サーバーに追加」モーダルを開くと、選択サーバーへのBot参加を確認します。Bot未参加時のみ、サーバー管理権限のある人に導入リンクを表示し、権限がない人には管理者への依頼を案内します。Discordから戻ると再確認します。確認APIの障害・レート制限を未参加とは扱いません。サーバー管理者が導入後、絵文字作成権限を持つユーザーが利用できます。常駐Gateway接続は不要です。

## Supabase

Emote Club専用プロジェクトで `supabase/migrations` のSQLを番号順に実行します。Data APIを有効にし、テーブルの自動公開は無効化。全テーブルにRLSを適用し、anon/authenticatedへの権限は付与しません。
`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY`（サーバー用secret keyも使用可）をサーバー側だけに設定します。Storageの `emoji-assets` は非公開。ブラウザ向け公開キーは不要です。
各素材・登録履歴にguild_idを保存します。APIは明示されたguildIdに対し所属を検証し、全DB操作をguild_idで絞ります。登録時はDiscordから権限を再取得、読み取り時は最長60秒のキャッシュを利用します。

素材は1件4MiB/16Mピクセル以内、1サーバー128MiB・500件まで。全体800MiBで停止します。未完了のアップロード/削除も容量に含め、トランザクションのロックで並行リクエストによる超過を防止します。
一覧は40件ずつ取得し、一括で5分間の署名付きURLを発行。画像はStorageから直接配信します。URLを知る人は有効期限内に閲覧できるため、退会直後も最長5分間は発行済みURLが使えます。URLはログ等へ残さないでください。
既存hukidamari-hubのプロジェクト・素材は変更しません。移行は別途データ移行として実施します。

## 公開

`SESSION_PASSWORD` はランダムな32文字以上、`SITE_URL` は公開HTTPS originを設定。秘密情報はデプロイナウのsensitive環境変数へ登録し、リポジトリへ含めません。
Next.jsは `output: standalone`。デプロイナウでは `npm ci --ignore-scripts` / `npm run build` を使用。npm用package-lock.jsonもコミットし、pnpm-lock.yamlと依存バージョンを揃えます。
`lolipop deploy --name emote-club --framework next` で初回公開。以降は既存project IDを指定して公開します。GitHubへのpushのみで自動公開される設定は別途連携が必要です。

## ローカル開発

Next.js 16.4.2では開発用Reactデバッグチャネルの接続待ちで画面の初期化が止まり、「ログイン状態を確認中…」のままになる場合があります。`next.config.ts` の `experimental.reactDebugChannel: false` で回避しています。認証APIが正常でもエディタ操作まで反応しない場合は、この設定と開発サーバーの再起動を確認してください。

## 障害復旧

Discord登録はリクエストUUIDで冪等化。送信結果不明（unknown/古いpending）は自動再送しません。Discordの絵文字一覧と監査ログを確認して、DBの該当 `emoji_registrations` をsucceeded（emoji_idを記録）またはfailedに修正します。確認前に履歴を消さないでください。
素材のpendingが10分以上残った場合、登録者か管理者がUIから削除できます。Storage削除成功後にDB行を削除して容量を解放します。

## 公開前確認

型チェック、lint、本番build、権限・画像・容量・冪等性のユニットテスト、HTTPのCookie/CSRF/PKCEテストを実行。
実サイトでOAuth、サーバー切替、非所属サーバーの拒否、素材の共有・再利用・削除、Bot導入、Discord登録を確認します。テストだけで実接続済みと判断しません。
