# デプロイ

ホスティングは Firebase Hosting（プロジェクト `dispersive-lab`、https://dispersive-lab.web.app ）。設定は `firebase.json` と `.firebaserc`。

## 手元からのデプロイ

Firebase CLI にログイン済みのアカウントで実行する。

```sh
npm run build
firebase deploy --only hosting
```

PR の確認用に一時的な URL を作るとき（7 日で消える）:

```sh
npm run build
firebase hosting:channel:deploy pr-<番号> --expires 7d
```

## GitHub Actions からの自動デプロイ

2026-11-23 に導入した（ユーザーの承認済み）。

| ワークフロー | きっかけ | 内容 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | PR・main への push | `npm ci` → 型チェック → テスト → ビルド |
| `.github/workflows/preview.yml` | PR | ビルドしてプレビューチャンネル（7 日で消える）にデプロイし、URL を PR にコメントする。フォークからの PR では動かない（シークレットが使えないため） |
| `.github/workflows/deploy.yml` | main への push（PR のマージ） | テスト・ビルドのあと本番（`live` チャンネル）にデプロイ |

デプロイには `FirebaseExtended/action-hosting-deploy@v0` を使う。

### 使っている資格情報

- サービスアカウント: `github-deploy@dispersive-lab.iam.gserviceaccount.com`
- ロール: `roles/firebasehosting.admin`（Hosting へのデプロイとプレビューチャンネルの作成）。事前計算のために、`roles/run.developer`（ジョブの作成・実行）、ジョブ用サービスアカウントへの `roles/iam.serviceAccountUser`、バケットへの `roles/storage.objectViewer`（結果の取得）。
- GitHub のシークレット: `FIREBASE_SERVICE_ACCOUNT_DISPERSIVE_LAB`（上のサービスアカウントの JSON キー）。鍵ファイルは手元に残していない。

### 作ったときの手順（鍵を作り直すときも同じ）

鍵ファイルはリポジトリの外（一時フォルダ）に作り、シークレットに登録したらすぐ消す。

```sh
# gcloud は uv の Python を指定して動かす（そのままでは Microsoft Store のエイリアスに解決されて動かない）
export CLOUDSDK_PYTHON=$(uv python find)
gcloud iam service-accounts create github-deploy --project dispersive-lab --display-name "GitHub Actions deploy"
gcloud projects add-iam-policy-binding dispersive-lab --member serviceAccount:github-deploy@dispersive-lab.iam.gserviceaccount.com --role roles/firebasehosting.admin --condition=None
KEY=$(mktemp -d)/key.json
gcloud iam service-accounts keys create "$KEY" --iam-account github-deploy@dispersive-lab.iam.gserviceaccount.com
GH_TOKEN=$(gh auth token --user yamayo-c) gh secret set FIREBASE_SERVICE_ACCOUNT_DISPERSIVE_LAB --repo yamayo-c/dispersive-lab < "$KEY"
rm -f "$KEY"
```

鍵を作り直したら、古い鍵は `gcloud iam service-accounts keys list / delete` で消す。

鍵ファイルを持たない方法として、Workload Identity 連携（`google-github-actions/auth`）もある。設定は増えるが、漏れて困る鍵が残らない。

## 事前計算（Cloud Run Jobs）

2026-11-23 に導入した（ユーザーの承認済み）。プロジェクトは Blaze プランで、請求先アカウントは Google Developer Program のクレジットが入るもの。使い方は [adding-a-phenomenon.md](adding-a-phenomenon.md) の「ブラウザで間に合わない計算」。

- ジョブ: `precompute`（`asia-northeast1`）。定義は `scripts/precompute.ts` の中にあり、計算が要るときに `sync` が作り直す（イメージは `.node-version` の Node）。公開リポジトリから指定のコミットを取ってきて `run` を呼ぶ。
- バケット: `gs://dispersive-lab-precomputed`（非公開）。`data/<slug>/<ハッシュ>/` に結果、`done/<slug>/<ハッシュ>/<タスク番号>` に完了の印。ジョブはバケットを `/out` にマウントして書く。
- ジョブ用サービスアカウント: `precompute-job@dispersive-lab.iam.gserviceaccount.com`。ロールはバケットへの `roles/storage.objectAdmin` だけ。
- 予算: クレジットを差し引いた費用で月 1,000 円（50%・90%・100% で請求先アカウントの管理者にメール）。

作ったときの手順:

```sh
export CLOUDSDK_PYTHON=$(uv python find)
P=dispersive-lab; B=dispersive-lab-precomputed
JOB=precompute-job@$P.iam.gserviceaccount.com; GH=github-deploy@$P.iam.gserviceaccount.com
gcloud services enable run.googleapis.com billingbudgets.googleapis.com cloudbilling.googleapis.com --project $P
gcloud storage buckets create gs://$B --project $P --location asia-northeast1 --uniform-bucket-level-access --public-access-prevention
gcloud iam service-accounts create precompute-job --project $P
gcloud storage buckets add-iam-policy-binding gs://$B --member serviceAccount:$JOB --role roles/storage.objectAdmin
gcloud storage buckets add-iam-policy-binding gs://$B --member serviceAccount:$GH --role roles/storage.objectViewer
gcloud projects add-iam-policy-binding $P --member serviceAccount:$GH --role roles/run.developer --condition=None
gcloud iam service-accounts add-iam-policy-binding $JOB --project $P --member serviceAccount:$GH --role roles/iam.serviceAccountUser
gcloud billing budgets create --billing-project=$P --billing-account=<請求先アカウントの ID> --display-name="dispersive-lab（クレジット差し引き後）" \
  --budget-amount=1000JPY --filter-projects=projects/$P --credit-types-treatment=include-all-credits \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```

## 読者が文章で実験を頼む機能（Firebase AI Logic）

2026-11-23 に導入した。ブラウザから Firebase AI Logic を直接呼び、読者の文章を実験の設定（JSON）に変える。AI が返すのは設定と候補だけで、結果は solver が出す（CLAUDE.md の方針）。

### 構成

- ウェブアプリ: `1:282451486766:web:1461d29176cbc4b53c17bf`。設定値（公開してよいものだけ）は `src/lib/firebaseConfig.ts`。
- モデル: `gemini-3.1-flash-lite`（Gemini API on Agent Platform（旧 Vertex AI）、`global`）。Gemini Developer API は有料枠に AI Studio での前払い（最低 $5）が要るので使わない。Agent Platform は Cloud Billing の従量課金。
- サーバー側テンプレート: `experiment-request`（`locations/global`）。正本は `ai/experiment-request.prompt`。モデル・システム指示・入力の長さ（問い 150 字・ページの情報 600 字）・出力のスキーマ（候補 3 つ・波 4 つまで）・思考（`thinkingLevel: minimal`）をサーバー側で固定する。
- テンプレート専用モード（`trafficFilter.templateOnly`）: テンプレートを通さない要求（モデルや設定をブラウザが選ぶ要求）を断る。
- App Check: reCAPTCHA Enterprise（スコア型キー `6LdAni0uAAAAAI1AWlZcG_7-jnQP35l6kfdKqOBz`、ドメインは `dispersive-lab.web.app`・`dispersive-lab.firebaseapp.com` だけ）。AI Logic（App Check のサービス ID は `firebaseml.googleapis.com`）に必須化し、リプレイ保護も必須（トークンは 1 回ごとに使い捨て。ブラウザは `useLimitedUseAppCheckTokens`）。
- Firebase と reCAPTCHA のスクリプトは、読者が送信したときに初めて読み込む（ページを開いただけでは読み込まず、評価も作らない）。

2026-11-23 時点で、Agent Platform のテンプレートでは `config.maxOutputTokens` が効かない（50 にしても 1,000 トークン以上返る）。`thinkingConfig.thinkingLevel` は効く（`high` で思考 28,621 トークン、`minimal` で 0）。出力の長さは、出力のスキーマ（候補と波の数・ラベルの長さ）で抑えている。テンプレートは、ブラウザが送る `history`・余分な入力・ツールを無視し、入力が上限を超えると 400 を返す（いずれも実測）。

### 費用の上限と根拠

料金（Cloud Billing のカタログ API、2026-11-23）: `gemini-3.1-flash-lite` の global エンドポイントで、テキスト入力 $0.25 / 100 万トークン（SKU `7DDF-162F-B3F3`）、テキスト出力（思考を含む）$1.50 / 100 万トークン（SKU `DA75-5E07-40DC`）。

1 回あたりのトークン数（実測）:

| | 入力 | 出力 | 費用 |
| --- | --- | --- | --- |
| ふつうの問い（20 件の平均） | 約 1,700 | 約 200 | 約 $0.0007 |
| 最悪（入力欄の上限いっぱいに、1 字あたりのトークンが多い文字を詰め、候補 3 つ・波 4 つを出させる） | 3,620 | 1,110 | $0.0026 |

最悪の値に余裕を見て 1 回 $0.003（入力 3,700・出力 1,300）とすると、1 日 100 回 × 31 日 = 3,100 回で **$9.3 / 月**。ふつうの問いなら同じ回数で約 $2.2 / 月。

上限は次のクォータで固定している（Cloud Quotas API の QuotaPreference。値を下げる変更は承認なしで入る）。

| クォータ | 値 | 効き方 |
| --- | --- | --- |
| `firebaseappcheck.googleapis.com` の `V1ExchangeRequestsPerDayPerProject`・`v1beta-ExchangeRequestsPerDayPerProject` | 100 / 日 | トークンは使い捨てなので、AI Logic への要求は 1 日 100 回まで。超えると交換が断られ、入力欄に「今日の受付は終わりました」と出る |
| `recaptchaenterprise.googleapis.com` の `CreateAssessmentRequestsPerDayPerProject` | 100 / 日 | reCAPTCHA の評価は月 3,100 件まで（無料枠は月 10,000 件） |
| `aiplatform.googleapis.com` の `GlobalGenerateContentInputTokensPerDayPerBaseModel`（`gemini-3.1-flash-lite`） | 400,000 / 日 | 入力トークンの念のための上限（1 日 100 回 × 3,700） |
| `firebaseappcheck.googleapis.com` の `V1EndUserExchangeRequestsPerMinutePerProjectPerUser`・`v1beta-EndUserExchangeRequestsPerMinutePerProjectPerUser` | 5 / 分 | 利用者ごとの回数制限 |
| `firebasevertexai.googleapis.com` の `GenerateContentRequestsPerMinutePerProjectPerUser`（全リージョン） | 5 / 分 | 利用者ごとの回数制限（AI Logic 側） |
| `firebasevertexai.googleapis.com` の `TemplateExecuteRequestsPerMinutePerProject` | 10 / 分（既定値のまま） | プロジェクト全体の 1 分あたりの上限 |

1 日の区切りはアメリカ太平洋時間の 0 時（Google Cloud のクォータの区切り）。上限を変えるときは、上の表の最悪の 1 回の費用から計算し直す。予算アラート（月 1,000 円）は別に残してある。

ブラウザ用の API キー（`Browser key (auto created by Firebase)`）は、使える API を `firebaseappcheck.googleapis.com`・`firebasevertexai.googleapis.com` に、リファラーを本番・プレビューチャンネル・localhost に制限している。

### テンプレートを変える

`ai/experiment-request.prompt` を直したら、同じ内容をサーバーに反映する（反映には数分かかる）。入力の上限を変えたら `src/lib/request.ts` の `QUESTION_MAX`・`PAGE_MAX` も揃える（`src/lib/request.test.ts` が確かめる）。

```sh
export CLOUDSDK_PYTHON=$(uv python find)
node -e 'process.stdout.write(JSON.stringify({templateString: require("fs").readFileSync("ai/experiment-request.prompt", "utf8")}))' > /tmp/tpl.json
curl -X PATCH -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: dispersive-lab" -H "Content-Type: application/json" \
  "https://firebasevertexai.googleapis.com/v1beta/projects/dispersive-lab/locations/global/templates/experiment-request?updateMask=templateString" --data-binary @/tmp/tpl.json
```

モデルを変えたら、料金を確かめ直して上の費用の計算と 1 日の上限を更新する。

### 手元で試す

reCAPTCHA のキーに localhost は入れていないので、`npm run dev` では App Check のデバッグトークンを使う（`npm run build` の成果物では使わない）。

1. デバッグトークンを登録する: `POST https://firebaseappcheck.googleapis.com/v1beta/projects/dispersive-lab/apps/1:282451486766:web:1461d29176cbc4b53c17bf/debugTokens`（本文 `{"displayName": "...", "token": "<UUID>"}`）。
2. コミットしない `.env.local` に `PUBLIC_APPCHECK_DEBUG_TOKEN=<UUID>` と書いて `npm run dev`。
3. 終わったらデバッグトークンを消す（`DELETE .../debugTokens/<ID>`）。デバッグトークンでの交換は別のクォータ（`debug_token_requests`）に数えられ、1 日の上限を通らないので、残さない。

### 作ったときの手順

```sh
export CLOUDSDK_PYTHON=$(uv python find) CLOUDSDK_BILLING_QUOTA_PROJECT=dispersive-lab
P=dispersive-lab; APP=1:282451486766:web:1461d29176cbc4b53c17bf
H=(-H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: $P" -H "Content-Type: application/json")
gcloud services enable firebasevertexai.googleapis.com aiplatform.googleapis.com firebaseappcheck.googleapis.com recaptchaenterprise.googleapis.com cloudquotas.googleapis.com apikeys.googleapis.com --project $P
firebase apps:create web dispersive-lab --project $P
gcloud recaptcha keys create --project=$P --display-name="dispersive-lab web (App Check)" --web --integration-type=score --domains=dispersive-lab.web.app,dispersive-lab.firebaseapp.com
curl -X PATCH "${H[@]}" "https://firebaseappcheck.googleapis.com/v1/projects/$P/apps/$APP/recaptchaEnterpriseConfig?updateMask=siteKey,tokenTtl" -d '{"siteKey":"<サイトキー>","tokenTtl":"3600s"}'
curl -X PATCH "${H[@]}" "https://firebaseappcheck.googleapis.com/v1beta/projects/$P/services/firebaseml.googleapis.com?updateMask=enforcementMode,replayProtection" -d '{"enforcementMode":"ENFORCED","replayProtection":"ENFORCED"}'
curl -X PATCH "${H[@]}" "https://firebasevertexai.googleapis.com/v1beta/projects/$P/locations/global/config?updateMask=trafficFilter.templateOnly" -d '{"trafficFilter":{"templateOnly":true}}'
# テンプレートの作成は POST .../locations/global/templates?promptTemplateId=experiment-request（本文は上の「テンプレートを変える」と同じ）
# クォータ（例。ほかも同じ形）
gcloud beta quotas preferences create --service=firebaseappcheck.googleapis.com --quota-id=V1ExchangeRequestsPerDayPerProject --preferred-value=100 --project=$P --preference-id=appcheck-exchange-per-day --justification="AI の費用を月 10 ドル以内に固定する"
```
