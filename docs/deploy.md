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

## GitHub Actions からの自動デプロイ（未導入）

main へのマージで本番、PR でプレビューチャンネルにデプロイする予定。導入にはサービスアカウントと GitHub のシークレットが要るので、作る前にユーザーの承認を得る。

### 作るもの（案）

- サービスアカウント: `github-deploy@dispersive-lab.iam.gserviceaccount.com`
- 付与するロール: `roles/firebasehosting.admin`（Firebase Hosting 管理者）だけ。Hosting へのデプロイとプレビューチャンネルの作成に足りる最小のロール。
- GitHub のシークレット: `FIREBASE_SERVICE_ACCOUNT_DISPERSIVE_LAB`（上のサービスアカウントの JSON キー）

### 手順

```sh
# gcloud は uv の Python を指定して動かす（そのままでは Microsoft Store のエイリアスに解決されて動かない）
export CLOUDSDK_PYTHON=$(uv python find)
gcloud iam service-accounts create github-deploy --project dispersive-lab --display-name "GitHub Actions deploy"
gcloud projects add-iam-policy-binding dispersive-lab \
  --member serviceAccount:github-deploy@dispersive-lab.iam.gserviceaccount.com \
  --role roles/firebasehosting.admin
gcloud iam service-accounts keys create key.json \
  --iam-account github-deploy@dispersive-lab.iam.gserviceaccount.com
GH_TOKEN=$(gh auth token --user yamayo-c) gh secret set FIREBASE_SERVICE_ACCOUNT_DISPERSIVE_LAB \
  --repo yamayo-c/dispersive-lab < key.json
rm key.json
```

ワークフローは `.github/workflows/` に 2 つ足す（`FirebaseExtended/action-hosting-deploy@v0` を使う）。

- `deploy.yml`（main への push）: `npm ci` → `npm test` → `npm run build` → `channelId: live` でデプロイ
- `preview.yml`（pull_request）: 同じ手順で、`channelId` を省略するとプレビューチャンネルにデプロイされ、URL が PR にコメントされる。フォークからの PR ではシークレットが使えないので `if: github.event.pull_request.head.repo.full_name == github.repository` を付ける。

鍵ファイルを持たない方法として、Workload Identity 連携（`google-github-actions/auth`）もある。設定は増えるが、漏れて困る鍵が残らない。
