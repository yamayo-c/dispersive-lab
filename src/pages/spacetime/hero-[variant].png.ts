import type { APIRoute, GetStaticPaths } from "astro";
import { HERO_VARIANTS, heroPng } from "../../viz/thumbnails";

/** トップの図 /spacetime/hero-wide.png・hero-tall.png（ビルド時に nls-two-soliton の solver を回して作る） */
export const getStaticPaths = (() => Object.keys(HERO_VARIANTS).map((variant) => ({ params: { variant } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const png = await heroPng(params.variant as keyof typeof HERO_VARIANTS);
  return new Response(png, { headers: { "Content-Type": "image/png" } });
};
