export interface QueuedConcept {
  id: string;
  fields: Record<string, unknown>;
}

/**
 * Read queued concepts from a brand's Airtable creative queue. Read only.
 * Returns [] when Airtable is not configured for the brand.
 */
export async function readCreativeQueue(
  opts: { token?: string; baseId?: string | null; table?: string | null; maxRecords?: number; view?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<QueuedConcept[]> {
  if (!opts.token || !opts.baseId || !opts.table) return [];
  const url = new URL(`https://api.airtable.com/v0/${opts.baseId}/${encodeURIComponent(opts.table)}`);
  url.searchParams.set("maxRecords", String(opts.maxRecords ?? 20));
  if (opts.view) url.searchParams.set("view", opts.view);
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${opts.token}` } });
  if (!res.ok) {
    console.warn(`[airtable] ${res.status} reading queue for base ${opts.baseId}`);
    return [];
  }
  const json = (await res.json()) as { records: { id: string; fields: Record<string, unknown> }[] };
  return json.records.map((r) => ({ id: r.id, fields: r.fields }));
}

/** Compact the queue into a prompt-friendly list. */
export function summariseQueue(records: QueuedConcept[], maxChars = 3000): string {
  if (!records.length) return "";
  const lines = records.map((r) => {
    const f = r.fields;
    const parts = Object.entries(f)
      .filter(([, v]) => typeof v === "string" && v.trim())
      .slice(0, 6)
      .map(([k, v]) => `${k}: ${String(v).replace(/\s+/g, " ").slice(0, 200)}`);
    return `- ${parts.join(" | ")}`;
  });
  return lines.join("\n").slice(0, maxChars);
}
