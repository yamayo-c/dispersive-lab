# dispersive-lab

非線形分散型方程式の数値実験を、ブラウザで動かして見る静的サイトです。
現象ごとに「解説・動かせるシミュレーション・数値検証」を1ページにまとめています。
今は非線形 Schrödinger 方程式（NLS）を扱っており、KdV・NLKG・sine-Gordon などを順に加えていきます。

**サイト: https://dispersive-lab.web.app**

## 数値検証

数値計算の誤りを「現象」として載せないよう、各ページの計算を次のいずれかでテストしています。

- 保存量（質量・エネルギーなど）のずれが閾値以内に収まる
- 格子と時間刻みを半分にしても結論が変わらない
- 厳密解と一致する

テストはページと同じ solver を Node で動かして CI で実行し、その内容は各ページの「この計算の検証」欄に載せています。

## 技術

- Astro + MDX + KaTeX（解説）、React（シミュレーション部分）
- solver は TypeScript（倍精度）。計算はすべてブラウザの Web Worker で行います
- Firebase Hosting

## 手元で動かす

Node 22.23.4 以上が必要です。

```sh
npm ci
npm run dev    # http://localhost:4321
npm test       # 数値検証を含むテスト
```

## ライセンス

- コード: [MIT License](LICENSE)
- 解説の本文（`src/content/phenomena/*/index.mdx`）: [CC BY 4.0](LICENSE-CONTENT)
