import type { MetaClient } from "@adpilot/meta";

export interface ResolvedInterest {
  id: string;
  name: string;
  audience_size_lower_bound?: number;
  audience_size_upper_bound?: number;
  /** what Claude asked for */
  query: string;
}

/**
 * Map interest names from the strategy to real Meta interest ids at brief
 * time, so the review page shows exactly what will ship. Reads only, so it
 * works in dry run. Unresolvable names are dropped and reported.
 */
export async function resolveInterests(meta: MetaClient, names: string[]): Promise<{ resolved: ResolvedInterest[]; unresolved: string[] }> {
  const resolved: ResolvedInterest[] = [];
  const unresolved: string[] = [];
  for (const q of names.slice(0, 8)) {
    try {
      const res = await meta.get<{ data: { id: string; name: string; audience_size_lower_bound?: number; audience_size_upper_bound?: number }[] }>("/search", {
        type: "adinterest",
        q,
        limit: 3,
      });
      // Prefer an exact (case-insensitive) name match, then the largest audience.
      const hits = res.data ?? [];
      const exact = hits.find((h) => h.name.toLowerCase() === q.toLowerCase());
      const pick = exact ?? hits.sort((a, b) => (b.audience_size_upper_bound ?? 0) - (a.audience_size_upper_bound ?? 0))[0];
      if (pick) resolved.push({ id: pick.id, name: pick.name, audience_size_lower_bound: pick.audience_size_lower_bound, audience_size_upper_bound: pick.audience_size_upper_bound, query: q });
      else unresolved.push(q);
    } catch (e) {
      console.warn(`[interests] lookup failed for "${q}": ${(e as Error).message}`);
      unresolved.push(q);
    }
  }
  // De-duplicate by id
  const seen = new Set<string>();
  return { resolved: resolved.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))), unresolved };
}
