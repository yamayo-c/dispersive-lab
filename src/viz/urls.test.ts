import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * /spacetime/*.png は firebase.json で 1 年キャッシュ（immutable）にしている。
 * 中身が変わってもブラウザに古い画像が残らないよう、URL は必ず src/viz/thumbnails.ts の thumbnailUrl・heroUrl で
 * 版の印（?v=）を付けて作る。ほかの場所に /spacetime/ の URL を直接書いていないことを確かめる。
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("時空図の画像の URL", () => {
  it("/spacetime/ の URL を作るのは thumbnails.ts だけ", () => {
    const offenders = files("src")
      .filter((f) => /\.(astro|tsx?|mdx)$/.test(f) && !f.endsWith(".test.ts"))
      .filter((f) => !f.replaceAll("\\", "/").endsWith("src/viz/thumbnails.ts"))
      .filter((f) => !f.replaceAll("\\", "/").includes("src/pages/spacetime/"))
      .filter((f) => /["'`]\/spacetime\//.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("thumbnails.ts が作る URL には ?v= が付く", () => {
    const src = readFileSync("src/viz/thumbnails.ts", "utf8");
    const urls = src.match(/`\/spacetime\/[^`]*`/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toContain("?v=");
  });
});
