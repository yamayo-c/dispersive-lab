# dispersive-lab

非線形分散型方程式の数値実験を見せる静的サイト。概要は README.md。

## 決まっている方針

- Astro + React（シミュレーション部分だけ React の island）。解説は MDX + KaTeX。1つの現象 = 1ページ = 1フォルダ。
- solver は TypeScript（Float64Array、倍精度）。ブラウザでは Web Worker で動かす。同じコードを Node で動かして CI の数値検証に使う（検証用に別言語の実装を持たない）。
- ホスティングは Firebase Hosting。main へのマージで本番に、PR ではプレビューチャンネルにデプロイする。
- サイトの実行時に AI を使わない。

## 数値検証

数値の不具合を「現象」として載せないことを最優先にする。各ページの検証テストには、次のどれかを必ず含める。

- 保存量（質量・エネルギーなど）のずれが閾値以内
- 解像度・時間刻みを半分にしても結論（散乱・爆発・ソリトンの個数など）が変わらない
- 厳密解との一致

- 検証テストの書き方と必須条件の詳細は [docs/adding-a-phenomenon.md](docs/adding-a-phenomenon.md)。テスト名の先頭に `[保存量]`・`[収束]`・`[厳密解]` の付箋を付け、`index.mdx` の `verification` と対応させる（`tests/conventions.test.ts` が確かめる）。

## 構成

- `src/solvers/` — FFT と方程式ごとの時間発展（今は周期境界 1 次元の Strang 分割 split-step Fourier: `i u_t + α u_xx + κ|u|²u = 0`）。
- `src/lib/` — 保存量（`conserved.ts`）、厳密解（`exact.ts`）、ノルム（`norms.ts`）、`sim.ts` の型と共通処理（`simulation.ts`）。
- `src/components/` — React の可視化部品（`Simulation.tsx` が island、`FieldPlot.tsx` が描画、`sim.worker.ts` が Web Worker での計算）。パラメータは URL のクエリに保存する。
- `src/content/phenomena/<slug>/` — 1 現象 1 フォルダ: `index.mdx`（解説）・`sim.ts`（初期値とパラメータ）・`verify.test.ts`（数値検証）。追加の手順は [docs/adding-a-phenomenon.md](docs/adding-a-phenomenon.md)。
- `src/layouts/PhenomenonLayout.astro` — 現象ページの枠（題名・方程式・シミュレーション・本文・「この計算の検証」欄）。

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
- デプロイと、未導入の GitHub Actions からの自動デプロイの手順は [docs/deploy.md](docs/deploy.md)。

## 題材の管理（Notion）

- 親ページ「数学可視化サイト」: https://app.notion.com/p/4201e85721e081b29146f01e7b42871d （運用ルールを記載）
- データベース「題材」: data source `collection://4201e857-21e0-8196-94ed-000b9899d179`
- 実装するのはステータスが「採用」の題材だけ。手順は親ページの運用ルールに従う。

## GitHub

- リモートのオーナーは `yamayo-c`。gh コマンドは `GH_TOKEN=$(gh auth token --user yamayo-c)` を付けて実行する。
