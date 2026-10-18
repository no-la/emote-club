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

`TRUST_PROXY_HOST=1` は、公開ホスト名で `X-Forwarded-Host` を上書きするプロキシの背後でのみ設定します。通常のローカル起動は未設定または `0`。有効時はヘッダーの単一値を `SITE_URL` と完全一致で検証し、更新APIはOriginも検証します。

`SESSION_PASSWORD` はランダムな32文字以上、`SITE_URL` は公開HTTPS originを設定。秘密情報はデプロイナウのsensitive環境変数へ登録し、リポジトリへ含めません。
Next.jsは `output: standalone`。デプロイナウでは `npm ci --ignore-scripts` / `npm run build` を使用。npm用package-lock.jsonもコミットし、pnpm-lock.yamlと依存バージョンを揃えます。
`lolipop deploy --name emote-club --framework next` で初回公開。以降は既存project IDを指定して公開します。GitHubへのpushのみで自動公開される設定は別途連携が必要です。

## ローカル開発

スマホなどからLAN経由で確認する場合は、開発サーバーを `DEV_ALLOWED_ORIGINS=192.168.0.21 pnpm dev --hostname 0.0.0.0` のように起動します。IPは開発機の現在のLANアドレスに置き換えます（複数はカンマ区切り）。この設定は開発用HMR接続の許可だけに使い、OAuthのリダイレクト先は変更しません。未設定の場合、LANからのHMR接続が拒否され、再接続失敗によりページが繰り返しリロードされます。


Next.js 16.4.2では開発用Reactデバッグチャネルの接続待ちで画面の初期化が止まり、「ログイン状態を確認中…」のままになる場合があります。`next.config.ts` の `experimental.reactDebugChannel: false` で回避しています。認証APIが正常でもエディタ操作まで反応しない場合は、この設定と開発サーバーの再起動を確認してください。

## 障害復旧

Discord登録はリクエストUUIDで冪等化。送信結果不明（unknown/古いpending）は自動再送しません。Discordの絵文字一覧と監査ログを確認して、DBの該当 `emoji_registrations` をsucceeded（emoji_idを記録）またはfailedに修正します。確認前に履歴を消さないでください。
旧方式の素材のpendingが10分以上残った場合、登録者か管理者がUIから削除できます。直接アップロードの未完了素材は、処理との競合を防ぐため予約期限の3時間後まで削除を保留し、自動回収します。Storage削除成功後にDB行を削除して容量を解放します。

## 公開前確認

型チェック、lint、本番build、権限・画像・容量・冪等性のユニットテスト、HTTPのCookie/CSRF/PKCEテストを実行。
実サイトでOAuth、サーバー切替、非所属サーバーの拒否、素材の共有・再利用・削除、Bot導入、Discord登録を確認します。テストだけで実接続済みと判断しません。

## 通信が止まった場合

共有APIの読み取りは20秒、更新は60秒でブラウザ側の通信を打ち切り、操作可能なエラー表示に戻す。通信切断時も保存自体は完了している可能性があるため、自動再送しない。共有ダイアログを閉じて一覧を更新し、保存済み・登録未完了の素材がないか確認してから再操作する。Discord登録は保持したリクエストIDで結果を再確認する。タイムアウトは待ち続ける画面の復旧であり、保存失敗の確定ではない。

## 共有素材の直接アップロード

202610180004_direct_uploads.sql を適用してからアプリを公開します。ブラウザは共有用の画像を最大2048px・3MiB以内へ縮小し、WebP（未対応ブラウザではPNG）に変換します。エディタ内への画像追加は従来のPNGのままです。

POST /api/emoji/assets は素材名のみを受け取り、Origin・最新の所属を検証して容量を予約します。返すのはIDと、非公開 emoji-upload-staging の固定パスへの署名付きアップロードURLのみです。クライアントにSupabaseのAPIキー・DB権限は渡しません。ブラウザはCookieなしでStorageへPUTし、その後 /api/emoji/assets/[id]/complete を呼びます。

確定は予約した本人・同じguildのみ可能で、管理者でも他人の予約を確定できません。確定処理は原子的に一度だけ取得し、実データのサイズ・形式・画素数・静止画を検証してsharpで再エンコードします。画像処理は5秒で制限します。検証済み出力のみ emoji-assets に保存し、readyに更新してから一覧の署名URLを発行します。確定済みIDの再送は既存結果を返します。未検証ファイルには閲覧URLを発行しません。

1ユーザーにつき1時間10回、直近10分の未完了予約3件まで。出力4MiBと一時保存4MiBを予約時に確保し、既存のguild128MiB・全体800MiB制限に含めます。署名URLは2時間有効・上書き禁止で、再発行しません。確定は発行から9分以内、容量予約と一時ファイルは3時間保持します。素材を削除しても一時保存の容量・発行履歴は残します。

期限切れの一時ファイルは、認証済みの一覧取得・新規予約に伴うafter処理で最大5件ずつ回収します（定時ジョブではなく、次回利用時の回収）。Storageの削除が成功してから予約を解放し、失敗時は保持して次回再試行します。未完了の出力も回収し、readyの素材は削除しません。アクセスがない間も予約上限は維持されます。

ロリポップの入口で16,384bytesを超えるPOSTがCloudFrontの403になることを実測しました。共有画像本体はこの経路を通りません。Discordへの絵文字登録は別の既存経路であり、この変更の対象外です。
