# 現象ページの追加手順

1 つの現象 = 1 ページ = 1 フォルダ。`src/content/phenomena/<slug>/` に 3 つのファイルを置けば、一覧とページが自動で生成される（登録の手作業は要らない）。事前計算の結果だけを見せるページは、`sim.ts` の代わりに `precompute.ts` を置く（6）。

```
src/content/phenomena/<slug>/
├── index.mdx        解説（frontmatter + 本文）
├── sim.ts           シミュレーションの定義（初期値・パラメータ・格子・時間刻み）
└── verify.test.ts   数値検証（vitest。ページと同じ solver を Node で動かす）
```

見本は `src/content/phenomena/gaussian-dispersion/`。迷ったらこれを写して書き換える。

## 1. slug を決める

- 英小文字・数字・ハイフンだけ（例: `soliton-collision`）。URL は `/phenomena/<slug>/` になる。
- フォルダ名がそのまま slug になる。

## 2. sim.ts

`defineSim({ params, setup })` を default export する。型は `src/lib/simulation.ts`。

- `params`: ページで操作できるパラメータ。`key` は英数字（URL のクエリ `?key=value` に使う）、`label` は Unicode で書く（KaTeX は使えない）。`min ≤ default ≤ max`。
- `setup(params)`: パラメータから計算の設定を返す。
  - `grid`: `makeGrid(n, L)`。n は 2 のべき。区間は `[-L/2, L/2)`。
  - `equation`: 今は `i u_t + α u_xx + κ|u|²u = 0` の `{ alpha, kappa }` だけ（κ = 0 で線形、κ > 0 で focusing、κ < 0 で defocusing）。
  - KdV 方程式 `u_t + 6uu_x + u_xxx = 0`（実数値）は `kind: "kdv"` にする（`equation` は無く、`initial`・`exact` は実数を返す）。`tStart` で計算を始める時刻を、`markers` でグラフに重ねる縦線の印を指定できる。見本は `src/content/phenomena/kdv-two-soliton/`。
  - `dt`、`stepsPerFrame`（描画 1 回で進めるステップ数）、`tEnd`（dt の整数倍）。
  - `initial(x)`: 初期値 `[Re, Im]`。
  - `exact(x, t)`（任意）: 厳密解。あればグラフに破線で重ね、誤差を画面に出す。
  - `yRange`（任意）: 縦軸の範囲。
- 周期境界であることに注意する。実数直線上の厳密解と比べるなら、解の裾が区間の端で丸め誤差以下になるよう L を広く取るか、線形方程式なら `periodize` で周期化する。
- ブラウザでの 1 コマの計算は 16 ms より十分短くする（n = 1024、stepsPerFrame = 数ステップなら 1 ms 未満）。

ブラウザ（Web Worker）も検証テストも同じ `setup` を呼ぶので、**ページで動く計算とテストで検証する計算は同じもの**になる。

## 3. index.mdx

frontmatter（スキーマは `src/lib/frontmatter.ts`）:

```yaml
title: ページの題名
summary: 一覧に出す 1〜2 文の説明
equation: i\,\partial_t u + \partial_x^2 u = 0   # KaTeX の display 数式。$$ は付けない
order: 20               # 一覧での並び順（小さい順）
equations: [linear-schrodinger]   # 扱う方程式。1 つ以上。src/lib/taxonomy.ts の EQUATIONS のキー
tags: [dispersion, exact-solution]  # 現象・概念。src/lib/taxonomy.ts の TAGS のキー（下の「分類の語彙」）
preprint:               # 任意。査読前の preprint に基づくページだけ書く
  arxiv: "2401.01234"   # arXiv の番号（版の v は付けない。旧形式 math/0601001 も可）。文字列として引用符で囲む
  version: 2            # 基にした版
verification:           # 「この計算の検証」欄。verify.test.ts のテストと対応させる
  - kind: exact         # conservation（保存量）/ convergence（収束）/ exact（厳密解）
    description: 何をどの閾値で確かめたか（実測値も書く）
```

本文は日本語。数式は `$...$`（インライン）と `$$...$$`（別行立て）。構成の目安:

1. **何が起きているか** — 現象と、それを支える数学（分散関係、保存則、厳密解など）。シミュレーションのどのパラメータを動かすと何が見えるか。
2. **計算の方法** — 使った数値解法と、その誤差の性質。周期境界などの設定が現象の見え方に影響するならそれも書く。

ページの上部（題名・preprint の注記・方程式・シミュレーション）と下部（検証欄）はレイアウト（`src/layouts/PhenomenonLayout.astro`）が出すので、本文には書かない。

### 分類の語彙（equations・tags）

`equations` と `tags` には、`src/lib/taxonomy.ts` にある語のキーだけを書ける（それ以外はスキーマが弾く）。一覧での絞り込みや方程式ごとのまとめに使うので、表記ゆれを作らないために語彙を固定している。

- まず既存の語から選ぶ。各語の `description` に、どんなページに付けるかが書いてある。方程式の名前はタグにしない（`equations` に書く）。
- 既存の語で言い表せないときだけ、同じ PR で `src/lib/taxonomy.ts` に語を足してよい。足す基準:
  - 既存の語の同義語・言い換え・細分ではない。
  - タグは、今あるページと Notion の題材（提案・採用）を合わせて 2 件以上に付く。
  - 方程式は Notion の題材データベースの「方程式」の選択肢と揃える（無ければ編集担当が Notion にも足す）。
  - キーは英小文字・数字・ハイフン、`label` はサイトに出す名前、`description` は付け分けの基準。
- PR の本文に「足した語・既存の語では足りない理由・付く予定のページや題材」を書く。

**語彙を変えた PR は自動マージされない。** ワークフロー `語彙のレビュー`（`.github/workflows/vocabulary.yml`）の必須チェック `vocabulary` が、編集担当のレビューを待つ。

1. PR に `needs-vocabulary-review` のラベルが自動で付き、`vocabulary` が失敗する（ほかのチェックが通っていても、マージは保留になる）。
2. 編集担当（ローカル・毎日 21:00）が上の基準でレビューする。
   - 承認: `vocabulary-approved` を付ける。`vocabulary` が通り、自動マージされる。
   - 差し戻し: 理由と代わりに使える既存の語を PR にコメントし、`vocabulary-rejected` を付ける。PR を出した側は、既存の語に直して `taxonomy.ts` の変更を外す（`vocabulary` が通る）か、語彙の変更を見直して push する（レビューのやり直しになる）。
3. 承認・差し戻しのあとに `taxonomy.ts` がさらに変わると、ラベルは外れてレビューをやり直す。
4. PR を出した側は、`vocabulary-approved` と `vocabulary-rejected` を自分で付けない。

## 4. verify.test.ts（必須）

**数値の不具合を「現象」として載せない**ための検証。次の 3 種類のうち **少なくとも 1 つ** を必ず含める。テスト名の先頭に種類の付箋を付ける。

| 付箋 | 内容 | 例 |
| --- | --- | --- |
| `[保存量]` | 保存量（質量・エネルギーなど）のずれが閾値以内 | `relativeDrift(mass(...), m0) < 1e-12` |
| `[収束]` | 解像度・時間刻みを半分にしても結論（散乱・爆発・ソリトンの個数など）が変わらない | N と N/2、Δt と Δt/2 で同じ結論になり、差が理論どおりに縮む |
| `[厳密解]` | 厳密解との一致 | 相対 L² 誤差 < 1e-10 |

書き方の決まり:

- `import sim from "./sim"` して、**ページと同じ `setup`（既定のパラメータ）で** 計算する。パラメータの範囲の端（四隅など）も確かめる。
- ページが主張する「結論」（例: ソリトンが 2 つに分かれる、有限時間で爆発する）を、解像度・時間刻みを半分にしても変わらないことで確かめる。
- 閾値は実測値に余裕を持たせて決め、実測値は `console.info` で出す（`npx vitest run --reporter=verbose` で見える）。`index.mdx` の `verification` にも実測値を書く。
- `index.mdx` の `verification` に書いた `kind` ごとに、対応する付箋のテストを置く（`tests/conventions.test.ts` が確かめる）。

`tests/conventions.test.ts` は次も確かめる: 3 ファイルがそろっている（`sim.ts` は `precompute.ts` で代えてよい）、slug の形式、frontmatter がスキーマ（`src/lib/frontmatter.ts`。preprint、equations・tags の語彙を含む）に合う、`sim.ts` があればその既定値で `setup` でき `tEnd` が `dt` の整数倍で n が 2 のべき。

## 5. 新しい方程式・solver が要るとき

`i u_t + α u_xx + κ|u|²u = 0` で書けない題材（KdV、NLKG、sine-Gordon など）は、ページの前に solver を足す。

1. `src/solvers/<name>.ts` に solver を書く（Float64Array、倍精度。FFT は `src/solvers/fft.ts`）。
2. `src/solvers/<name>.test.ts` に、solver そのものの検証（厳密解との一致と、時間刻みを半分にしたときの誤差の比から求めた収束の次数）を書く。
3. `src/lib/simulation.ts` の `SimSetup` に設定の型を union で足し、`createSolver` と `src/components/sim.worker.ts` を対応させる。保存量は `src/lib/conserved.ts` に足す。

## 6. ブラウザで間に合わない計算

2 次元以上・長時間・パラメータを振った地図など、ブラウザで間に合わない計算は、ページのフォルダに `precompute.ts` を置いて事前に計算する。

- `definePrecompute({ tasks, run })` を default export する（型は `src/lib/precompute.ts`）。`run` で solver を動かし、`write(name, data)` で結果を書く。`tasks` を 2 以上にすると、タスクに分けて並列に動く（`taskIndex` で分担を決める）。1 タスクは 2 vCPU・4 GiB・6 時間まで。
- 書いた結果はサイトの `/precomputed/<slug>/<name>` に置かれる。表示の部品が足りなければ、そのページに要るものを足す。
- 事前計算の結果だけを見せるページでは `sim.ts` を省ける（ブラウザでのシミュレーションは出ない）。
- `run` の中で検証（保存量のずれ・厳密解との誤差など）を測り、閾値を超えたら例外を投げる。例外が出ると CI が失敗し、公開されない。`verify.test.ts` には同じ計算を小さくした設定で検証を書く（4 の決まりは同じ）。
- 手元では `npm run precompute -- run <slug>` で `public/precomputed/<slug>/` に書き出してから確かめる。
- CI（`ci.yml`・`preview.yml`・`deploy.yml`）は `npm run precompute -- sync` で、計算に関わるファイル（ページのフォルダのうち `index.mdx`・`verify.test.ts` 以外、`src/solvers`・`src/lib`・`scripts/precompute.ts`・依存関係）が変わったときだけ Cloud Run Jobs で計算し直し、結果を取ってくる。解説の本文を直しただけでは計算し直さない。CI とプレビューは同じコミットで同時に `sync` を呼ぶが、同じハッシュの計算が走っていれば後から来た側はそれを待つ。資格情報は [deploy.md](deploy.md)。

## 7. 確かめてから PR を出す

```sh
npm test          # 数値検証を含む全テスト
npm run check     # 型チェック（astro check）
npm run build     # 静的サイトを dist/ に出力
npm run preview   # dist/ を http://localhost:4321 で表示して、ページが動くか確かめる
```

PR の本文には、検証テストの実測値（誤差、収束の次数、保存量のずれ）を書く。preprint に基づくページなら、arXiv の番号と版も書く。

## 8. 公開後レビュー

CI（ジョブ `check`: 型チェック・数値検証を含むテスト・ビルド）が通った PR は自動でマージされ、本番に公開される。ただし分類の語彙（`src/lib/taxonomy.ts`）を変えた PR は、編集担当のレビュー（必須チェック `vocabulary`。「分類の語彙」）を通す。ユーザー（著者）のレビューは公開の **あと** に行う。

### 査読の状態

- 著者が数学的な内容を確かめたかどうかは、Notion の題材データベースのステータス（「公開（未査読）」→「公開済み」）だけで管理する。サイトには出さない（閲覧者には関係のない情報なので、frontmatter にも項目を持たない）。
- ステータスを「公開済み」に移すのはユーザー。サイト側の変更は要らないので、PR は出さない。

### preprint

- 査読前の preprint（arXiv など）に基づくページは `preprint: { arxiv, version }` を書く。ページに「査読前の preprint に基づく」旨と arXiv の版つきのページ（`https://arxiv.org/abs/<番号>v<版>`）へのリンクが出て、一覧のカードにも「preprint」の印が付く。
- 番号と版は、実際に arXiv で確かめたものだけを書く。新しい版に合わせてページを直したら `version` も上げる。
- preprint が雑誌に載っても、この欄は基にした版を記録するものなので、ページの内容を見直すまでは残す。

### 取り下げる

ユーザーが Notion のカードを「取り下げ」に移したら、そのページの **フォルダごと**（`src/content/phenomena/<slug>/`）削除する PR を出す（ブランチ例: `withdraw/<slug>`）。

- PR の本文に、取り下げの理由（Notion のカードのコメント）を書き写す。
- ほかのページ・docs からそのページへのリンクがあれば、同じ PR で外す（`git grep <slug>` で探す）。
- CI が通れば自動でマージされ、ページと一覧から消える。
- 消したページの URL は 404 になる。中身は git の履歴に残るので、あとで直して出し直すときはそこから戻せる。
