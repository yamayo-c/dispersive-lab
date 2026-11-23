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

## 読者が文章で実験を頼む機能（凍結中）

2026-11-23 に PR #9・#10 で入れ、同日に PR #14 でサイトから外した（コードは削除）。戻すときは、PR #14 を revert し、Firebase AI Logic の API（`firebasevertexai.googleapis.com`）を有効にし、新しいブラウザ用 API キーを作って（使える API を App Check と AI Logic に、リファラーを本番と localhost に制限）`src/lib/firebaseConfig.ts` の `apiKey` を差し替える（旧キーは漏えいの検出を受けて 2026-11-23 に削除した。App Check・reCAPTCHA キー・サーバー側テンプレート `experiment-request`・テンプレート専用モード・クォータは残してある）。費用の上限は、戻す PR の時点の [数式の照合](#数式の照合gemini) と足して計算し直す。

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
- 1 日の上限は **1 回**（日本時間の日付ごと）。Agent Platform のクォータ（`aiplatform.googleapis.com` の `GlobalGenerateContentInputTokensPerDayPerBaseModel`）は直接の呼び出しに効かない（2026-11-23、21,000 トークン / 日にしても通り、Cloud Monitoring に使用量が記録されない）ので、AI を呼ぶ前に `gs://dispersive-lab-precomputed/formula-review/<日付>` を作成専用（`ifGenerationMatch=0`）で作り、作れたときだけ呼ぶ。`github-deploy` に許しているのはこの接頭辞への作成だけ（`roles/storage.objectCreator` を IAM の条件で絞る）で、消す・上書きはできない。その日の印がもうあると照合は失敗し、翌日以降に失敗したチェックを再実行する。
- 最悪の費用は 1 日 1 回 × $0.264 × 31 日 = **$8.18 / 月**（CLAUDE.md の月 $10 以内）。ふつうは 1 回 $0.10〜0.21。
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

手元で照合するときは `VERTEX_TOKEN=$(gcloud auth print-access-token) QUOTA_PROJECT=$P node scripts/formula-review.ts check <slug>`（その日の 1 回を使う）。モデルを変えたら、料金と最悪の 1 回の費用を測り直して、この節を計算し直す。
