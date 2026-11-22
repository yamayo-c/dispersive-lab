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
- ロール: `roles/firebasehosting.admin`（Firebase Hosting 管理者）だけ。Hosting へのデプロイとプレビューチャンネルの作成に足りる最小のロール。
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
