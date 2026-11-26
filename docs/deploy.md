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
- バケット: `gs://dispersive-lab-precomputed`（非公開）。`data/<slug>/<ハッシュ>/` に結果、`done/<slug>/<ハッシュ>/<タスク番号>` に完了の印。ジョブはバケットを `/out` にマウントして書き、完了の印があるタスクは計算しない。
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

## アクセス解析（Google Analytics）

2026-11-26 に導入した（ユーザーの承認済み）。

- Firebase プロジェクトと連携した GA4 プロパティ `dispersive-lab`（プロパティ ID 565929643）。GA アカウントは新しく作った `dispersive-lab`（ID 417471914）。地域は日本、データ共有の任意項目はすべてオフ。
- データストリームは Web アプリ `1:282451486766:web:1461d29176cbc4b53c17bf` のもの（ストリーム ID 16420903686、測定 ID `G-LLWNTH01RM`）。
- タグは Firebase JS SDK を使わず、gtag.js を `src/layouts/BaseLayout.astro` に直接埋め込んでいる。送るのは本番のホスト（`dispersive-lab.web.app`・`dispersive-lab.firebaseapp.com`）で開いたときだけで、localhost とプレビューチャンネル（`dispersive-lab--pr-…web.app`）では gtag.js を読み込まない（プレビューも本番ビルドなので、実行時に `location.hostname` で判定する）。
- シミュレーションのパラメータは URL のクエリに入るので、`page_view` の `page_location` にもクエリが入る（想定どおり）。
- GA の規約で Cookie による計測をサイト上で知らせる必要があるので、プライバシーのページ `src/pages/privacy.astro`（`/privacy/`）を置き、全ページのフッターからリンクしている。
- データの保持期間: 2026-11-26 に（ユーザーの承認済み）、GA の管理画面（プロパティ `dispersive-lab` → データの収集と修正 → データの保持）でイベントデータを 2 か月（既定）から 14 か月に延ばした。ユーザーデータは既定の 14 か月、「新しいユーザー アクティビティのたびにリセット」はオンのまま。
  - 保持期間が効くのは探索レポートとユーザー単位のデータだけで、標準のレポートには影響しない。あとから延ばしても過去のデータは戻らないので、クエリに入るシミュレーションのパラメータを探索レポートで 1 年分見比べられるよう、早めに延ばした。

## 読者が文章で実験を頼む機能（凍結中）

2026-11-23 に PR #9・#10 で入れ、同日に PR #14 でサイトから外した（コードは削除）。戻すときは、PR #14 を revert し、Firebase AI Logic の API（`firebasevertexai.googleapis.com`）を有効にし、新しいブラウザ用 API キーを作って（使える API を App Check と AI Logic に、リファラーを本番と localhost に制限）`src/lib/firebaseConfig.ts` の `apiKey` を差し替える（旧キーは漏えいの検出を受けて 2026-11-23 に削除した。App Check・reCAPTCHA キー・サーバー側テンプレート `experiment-request`・テンプレート専用モード・クォータは残してある）。費用の上限（CLAUDE.md の月 $10 以内）は、戻す PR で 1 日の回数上限を決めて計算し直す。
