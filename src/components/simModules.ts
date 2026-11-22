import type { SimDefinition } from "../lib/simulation";

/**
 * src/content/phenomena/<slug>/sim.ts を slug から読み込む。
 * import.meta.glob で集めるので、ページを足しても登録の手作業は要らない。
 */
const modules = import.meta.glob<{ default: SimDefinition }>("../content/phenomena/*/sim.ts");

export async function loadSim(slug: string): Promise<SimDefinition> {
  const load = modules[`../content/phenomena/${slug}/sim.ts`];
  if (!load) throw new Error(`sim.ts が見つからない: ${slug}`);
  return (await load()).default;
}
