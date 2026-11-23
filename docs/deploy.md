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
- ロール: `roles/firebasehosting.admin`（Hosting へのデプロイとプレビューチャンネルの作成）。事前計算のために、`roles/run.developer`（ジョブの作成・実行）、ジョブ用サービスアカウントへの `roles/iam.serviceAccountUser`、バケットへの `roles/storage.objectViewer`（結果の取得）。数式の照合のために、カスタムロール `projects/dispersive-lab/roles/geminiCaller`（`aiplatform.endpoints.predict` だけ）と、バケットの `formula-review/` への `roles/storage.objectCreator`。
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

AI の費用は、この機能と [数式の照合](#数式の照合gemini) の最悪を足して **$1.40 + $8.18 = $9.58 / 月** に固定している（CLAUDE.md の月 $10 以内）。どちらかの上限・モデル・料金を変えるときは、両方を足して計算し直す。

料金（Cloud Billing のカタログ API、2026-11-23）: `gemini-3.1-flash-lite` の global エンドポイントで、テキスト入力 $0.25 / 100 万トークン（SKU `7DDF-162F-B3F3`）、テキスト出力（思考を含む）$1.50 / 100 万トークン（SKU `DA75-5E07-40DC`）。

1 回あたりのトークン数（実測）:

| | 入力 | 出力 | 費用 |
| --- | --- | --- | --- |
| ふつうの問い（20 件の平均） | 約 1,700 | 約 200 | 約 $0.0007 |
| 最悪（入力欄の上限いっぱいに、1 字あたりのトークンが多い文字を詰め、候補 3 つ・波 4 つを出させる） | 3,620 | 1,110 | $0.0026 |

最悪の値に余裕を見て 1 回 $0.003（入力 3,700・出力 1,300）とすると、1 日 15 回 × 31 日 = 465 回で **$1.40 / 月**。ふつうの問いなら同じ回数で約 $0.33 / 月。

上限は次のクォータで固定している（Cloud Quotas API の QuotaPreference。値を下げる変更は承認なしで入る）。

| クォータ | 値 | 効き方 |
| --- | --- | --- |
| `firebaseappcheck.googleapis.com` の `V1ExchangeRequestsPerDayPerProject`・`v1beta-ExchangeRequestsPerDayPerProject` | 15 / 日 | トークンは使い捨てなので、AI Logic への要求は 1 日 15 回まで。超えると交換が断られ、入力欄に「今日の受付は終わりました」と出る |
| `recaptchaenterprise.googleapis.com` の `CreateAssessmentRequestsPerDayPerProject` | 15 / 日 | reCAPTCHA の評価は月 465 件まで（無料枠は月 10,000 件） |
| `firebaseappcheck.googleapis.com` の `V1EndUserExchangeRequestsPerMinutePerProjectPerUser`・`v1beta-EndUserExchangeRequestsPerMinutePerProjectPerUser` | 10 / 分 | 利用者ごとの交換の上限。AI Logic 側（5 / 分）より緩くして、交換の 429 を 1 日の上限の合図として使えるようにしている |
| `firebasevertexai.googleapis.com` の `GenerateContentRequestsPerMinutePerProjectPerUser` | 5 / 分 | 利用者ごとの回数制限（実測で効く。超えると「混み合っています」） |
| `firebasevertexai.googleapis.com` の `TemplateExecuteRequestsPerMinutePerProject` | 10 / 分（既定値のまま） | プロジェクト全体の 1 分あたりの上限 |

Agent Platform 側のクォータ（`aiplatform.googleapis.com` の `GlobalGenerateContentInputTokensPerDayPerBaseModel`）は、AI Logic 経由の要求にも、数式の照合の直接の呼び出し（`gemini-4-carbon`）にも効かなかった（2026-11-23。それぞれ 1,000・21,000 トークン / 日にしても通り、Cloud Monitoring に使用量が記録されない）。`gemini-3.1-flash-lite` は 400,000、`gemini-4-carbon` は 21,000 / 日にしてあるが、上限としては数えない。

1 日の交換の上限は実際に効くことを確かめた（2026-11-23、上限を 1 にして交換が `Token exchange requests per day` の 429 で断られ、入力欄が「今日の受付は終わりました」になった）。クォータの値を変えてから効くまで数分かかる。1 日の区切りはアメリカ太平洋時間の 0 時（Google Cloud のクォータの区切り）。上限を変えるときは、上の表の最悪の 1 回の費用から計算し直す。予算アラート（月 1,000 円）は別に残してある。

ブラウザ用の API キー（`Browser key (auto created by Firebase)`）は、使える API を `firebaseappcheck.googleapis.com`・`firebasevertexai.googleapis.com` に、リファラーを本番（`dispersive-lab.web.app`・`dispersive-lab.firebaseapp.com`）と localhost の 4321・4322 番に制限している。

プレビューチャンネルでこの機能を試すときは、そのチャンネルのドメイン（`dispersive-lab--pr<番号>-….web.app`）を reCAPTCHA のキーの `--domains` と API キーの `--allowed-referrers` に一時的に足し、マージしたら外す（どちらもホスト名の途中にワイルドカードを書けない）。足さないと、プレビューでは送信が「送れませんでした」になる（ほかの機能はそのまま動く）。

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
gcloud beta quotas preferences create --service=firebaseappcheck.googleapis.com --quota-id=V1ExchangeRequestsPerDayPerProject --preferred-value=15 --project=$P --preference-id=appcheck-v1-exchange-per-day --justification="AI の費用を月 10 ドル以内に固定する"
```

## 数式の照合（Gemini）

2026-11-23 に導入した（ユーザーの承認済み）。現象ページを変える PR で、解説と実装の明白な不一致を Gemini に探させ、見つかれば必須チェック `formula-review` を失敗させる。運用は [adding-a-phenomenon.md](adding-a-phenomenon.md) の「数式の照合」。

- ワークフロー: `.github/workflows/formula-review.yml`。本体は `scripts/formula-review.ts`、プロンプトは `ai/formula-review.prompt`。
- モデル: `gemini-4-carbon`（Gemini API on Agent Platform、`global`）。実装担当（Claude）と別系統の、呼べる中で最上位のもの。思考 `MEDIUM`、出力は structured output（判定と指摘の一覧）。
- 資格情報: 上の `github-deploy` サービスアカウント（カスタムロール `geminiCaller` = `aiplatform.endpoints.predict` だけ。1 日 1 回の印のための作成権限は下）。
- 送るもの: 変わったページのファイル（照合の対象）と、規約のファイル（`schrodinger.ts`・`simulation.ts`・`exact.ts`・`conserved.ts`）・ページが import する `src/lib`・`src/solvers` のファイル（参照）。ページごとに 1 回呼ぶ。

### 費用の上限と根拠

料金（Cloud Billing のカタログ API、2026-11-23）: `gemini-4-carbon` の global のオンライン予測で、テキスト入力 $4 / 100 万トークン（SKU `C47F-BE66-1A4E`）、テキスト出力 $20 / 100 万トークン（SKU `1B77-85A0-B300`。思考も出力として数える）。Flex（半額）はこのモデルでは使えない（400 が返る）。

1 回あたりのトークン数（実測）:

| | 入力 | 出力（思考を含む） | 費用 |
| --- | --- | --- | --- |
| `gaussian-dispersion` | 15,160 | 2,093 | $0.10 |
| `nls-soliton` | 18,350 | 3,819 | $0.15 |
| わざと誤りを入れた版（6 通り） | 15,159〜18,350 | 3,296〜6,732 | $0.13〜$0.21 |
| 最悪（入力・出力とも上限） | 21,000 | 9,000 | $0.264 |

- 1 回の出力は `maxOutputTokens` = 9,000 で切る（Agent Platform の直接の呼び出しでは思考を含めて効く。2026-11-23 に 300 で確かめた）。切れたら照合は失敗する。
- 1 回の入力は 21,000 トークンまで（`countTokens` で測り、超えるページは呼ばずに失敗させる）。
- 1 日の上限は **1 回**（日本時間の日付ごと）。Agent Platform のクォータは効かない（上の読者の節）ので、AI を呼ぶ前に `gs://dispersive-lab-precomputed/formula-review/<日付>` を作成専用（`ifGenerationMatch=0`）で作り、作れたときだけ呼ぶ。`github-deploy` に許しているのはこの接頭辞への作成だけ（`roles/storage.objectCreator` を IAM の条件で絞る）で、消す・上書きはできない。その日の印がもうあると照合は失敗し、翌日以降に失敗したチェックを再実行する。
- 最悪の費用は 1 日 1 回 × $0.264 × 31 日 = **$8.18 / 月**。ふつうは 1 回 $0.10〜0.21。
- 同じ入力の結果は PR のコメントに残したハッシュで使い回すので、ラベルの付け外しやページ以外の push では呼ばない。`countTokens` は無料。

### 作ったときの手順

```sh
export CLOUDSDK_PYTHON=$(uv python find) CLOUDSDK_BILLING_QUOTA_PROJECT=dispersive-lab
P=dispersive-lab; GH=github-deploy@$P.iam.gserviceaccount.com
gcloud iam roles create geminiCaller --project $P --title "Gemini の呼び出し（数式の照合）" --permissions aiplatform.endpoints.predict --stage GA
gcloud projects add-iam-policy-binding $P --member serviceAccount:$GH --role projects/$P/roles/geminiCaller --condition=None
gcloud storage buckets add-iam-policy-binding gs://dispersive-lab-precomputed --member serviceAccount:$GH --role roles/storage.objectCreator \
  --condition='expression=resource.name.startsWith("projects/_/buckets/dispersive-lab-precomputed/objects/formula-review/"),title=formula-review-daily-mark'
GH_TOKEN=$(gh auth token --user yamayo-c) gh label create formula-review-approved --repo yamayo-c/dispersive-lab --color 0E8A16
```

手元で照合するときは `VERTEX_TOKEN=$(gcloud auth print-access-token) QUOTA_PROJECT=$P node scripts/formula-review.ts check <slug>`（その日の 1 回を使う）。モデルを変えたら、料金と最悪の 1 回の費用を測り直して、この節と上の読者の上限を合わせて計算し直す。
