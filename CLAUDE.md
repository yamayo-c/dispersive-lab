# dispersive-lab

非線形分散型方程式の数値実験を見せる静的サイト。概要は README.md。

## 決まっている方針

- Astro + React（シミュレーション部分だけ React の island）。解説は MDX + KaTeX。1つの現象 = 1ページ = 1フォルダ。
- solver は TypeScript（Float64Array、倍精度）。ブラウザでは Web Worker で動かす。同じコードを Node で動かして CI の数値検証に使う（検証用に別言語の実装を持たない）。
- ホスティングは Firebase Hosting。main へのマージで本番に、PR ではプレビューチャンネルにデプロイする。
- サイトの実行時に AI を使わない。

## 公開後レビュー

- CI（ジョブ `check`: 型チェック・数値検証を含むテスト・ビルド）が通った PR は自動でマージして公開する。ユーザーのレビューは公開 **後** に行い、問題があれば取り下げる。
  - main はブランチ保護で `check` の成功を必須にしている（レビュー必須・最新の main の取り込み必須は付けない。管理者は対象外）。リポジトリは auto-merge を許可し、マージ後にブランチを自動で消す。
  - PR を出したら `gh pr merge <番号> --auto --merge` で自動マージを設定する。
- 査読の状態（ユーザーが数学的に確かめたか）は Notion の題材データベースのステータス（公開（未査読）／公開済み）だけで管理し、サイトには出さない。frontmatter にも項目を持たないので、「公開済み」になってもサイト側の PR は要らない。
- arXiv などの preprint も題材にする。preprint に基づくページは frontmatter の `preprint: { arxiv, version }` で「査読前の preprint に基づく」旨と arXiv へのリンクを出す。
- 取り下げはページのフォルダごと削除する PR。書き方と手順は [docs/adding-a-phenomenon.md](docs/adding-a-phenomenon.md) の「公開後レビュー」。

## 数値検証

数値の不具合を「現象」として載せないことを最優先にする。各ページの検証テストには、次のどれかを必ず含める。

- 保存量（質量・エネルギーなど）のずれが閾値以内
- 解像度・時間刻みを半分にしても結論（散乱・爆発・ソリトンの個数など）が変わらない
- 厳密解との一致

- 検証テストの書き方と必須条件の詳細は [docs/adding-a-phenomenon.md](docs/adding-a-phenomenon.md)。テスト名の先頭に `[保存量]`・`[収束]`・`[厳密解]` の付箋を付け、`index.mdx` の `verification` と対応させる（`tests/conventions.test.ts` が確かめる）。

## 構成

- `src/solvers/` — FFT と方程式ごとの時間発展（今は周期境界 1 次元の Strang 分割 split-step Fourier: `i u_t + α u_xx + κ|u|²u = 0`）。
- `src/lib/` — 保存量（`conserved.ts`）、厳密解（`exact.ts`）、ノルム（`norms.ts`）、`sim.ts` の型と共通処理（`simulation.ts`）、`index.mdx` の frontmatter のスキーマ（`frontmatter.ts`。`content.config.ts` とテストが共用）。
- `src/components/` — React の可視化部品（`Simulation.tsx` が island、`FieldPlot.tsx` が描画、`sim.worker.ts` が Web Worker での計算）。パラメータは URL のクエリに保存する。
- `src/content/phenomena/<slug>/` — 1 現象 1 フォルダ: `index.mdx`（解説）・`sim.ts`（初期値とパラメータ）・`verify.test.ts`（数値検証）。追加の手順は [docs/adding-a-phenomenon.md](docs/adding-a-phenomenon.md)。
- `src/layouts/PhenomenonLayout.astro` — 現象ページの枠（題名・preprint の注記・方程式・シミュレーション・本文・「この計算の検証」欄）。

## コマンド

```sh
npm ci                # 依存関係を入れる（Node 22.23.4 以上。CI は .node-version）
npm test              # vitest。数値検証を含む全テスト（実測値は --reporter=verbose で出る）
npm run check         # 型チェック（astro check）
npm run build         # dist/ に静的サイトを出力
npm run preview       # dist/ を http://localhost:4321 で表示
firebase deploy --only hosting   # 手元から本番へデプロイ（build のあと）
```

- Markdown の処理系は Astro 7 の既定（Sätteri）ではなく `unified()`（`@astrojs/markdown-remark`）にして、remark-math + rehype-katex を使っている（`astro.config.mjs`）。
- PR ではプレビューチャンネルに、main へのマージで本番に GitHub Actions が自動でデプロイする（`preview.yml`・`deploy.yml`）。資格情報と手順は [docs/deploy.md](docs/deploy.md)。

## 題材の管理（Notion）

- 親ページ「数学可視化サイト」: https://app.notion.com/p/4201e85721e081b29146f01e7b42871d （運用ルールを記載）
- データベース「題材」: data source `collection://4201e857-21e0-8196-94ed-000b9899d179`
- 実装するのはステータスが「採用」の題材だけ。手順は親ページの運用ルールに従う。
- ステータスの流れ: 提案 → 採用 → 作業中 → レビュー待ち（PR が CI 待ち・CI 失敗）→ 公開（未査読）→ 公開済み（ユーザーが査読済み）。ほかに 取り下げ（公開をやめる）と 見送り（作らない）。
  - 「公開（未査読）」と「公開済み」の違いは Notion の中だけにあり、サイトの表示は同じ。
  - 「公開済み」「取り下げ」「見送り」はユーザーが決める。エージェントはそれに合わせて PR を出す（「取り下げ」→ フォルダを消す PR。「公開済み」「見送り」はサイト側の変更なし）だけで、ステータスを自分の判断で戻さない。

## GitHub

- リモートのオーナーは `yamayo-c`。gh コマンドは `GH_TOKEN=$(gh auth token --user yamayo-c)` を付けて実行する。
