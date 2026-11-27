import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { hasThumbnail, thumbnailPng } from "../../viz/thumbnails";

/** 一覧のサムネイル /spacetime/<slug>.png（ビルド時に solver を回して作る。src/viz/thumbnails.ts） */
export const getStaticPaths = (async () => {
  const entries = await getCollection("phenomena");
  return entries.filter((e) => hasThumbnail(e.id)).map((e) => ({ params: { slug: e.id } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const png = await thumbnailPng(params.slug!);
  if (!png) return new Response(null, { status: 404 });
  return new Response(png, { headers: { "Content-Type": "image/png" } });
};
