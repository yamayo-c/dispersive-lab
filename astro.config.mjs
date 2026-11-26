// @ts-check
import mdx from "@astrojs/mdx";
import { unified } from "@astrojs/markdown-remark";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

// https://astro.build/config
export default defineConfig({
  site: "https://dispersive-lab.web.app",
  // sitemap: Google Search Console に送るサイトマップ（docs/deploy.md の「検索（Google Search Console）」）
  integrations: [react(), mdx(), sitemap()],
  markdown: {
    // 数式は remark-math + rehype-katex でビルド時に HTML にする（MDX もこの設定を引き継ぐ）
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex],
    }),
  },
});
