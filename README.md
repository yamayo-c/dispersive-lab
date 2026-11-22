# dispersive-lab

非線形分散型方程式（NLS・KdV・NLKG・sine-Gordon など）の数値実験を、ブラウザ上で動かして見せる静的サイト。
ソリトンの衝突、爆発と散乱、Talbot 効果など、現象ごとに「解説 + 動くシミュレーション + 数値検証」を1ページにまとめる。

収益は目的にしない。計算はすべてブラウザ側で行い、サイトの実行時に AI は使わない。
ページの追加は、Notion で管理する題材をもとにスケジュール実行のエージェントが PR を出し、CI（数値検証を含む）が通れば自動でマージして公開する。人のレビューは公開後に行い、それまでのページには「未査読」の印を出す。

- サイト: https://dispersive-lab.web.app
- 技術: Astro + React（シミュレーション部分）+ MDX + KaTeX。solver は TypeScript（倍精度）で、ブラウザでは Web Worker、CI では Node で同じコードを動かして数値検証する。
- 開発の手順とコマンドは [CLAUDE.md](CLAUDE.md)、ページの追加は [docs/adding-a-phenomenon.md](docs/adding-a-phenomenon.md)。
