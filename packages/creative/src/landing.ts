/** Fetch a landing page and strip it to readable text (bounded). */
export async function fetchLandingText(url: string, maxChars = 6000, fetchImpl: typeof fetch = fetch): Promise<string> {
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": "AdPilot/1.0 (+landing-page-reader)" }, redirect: "follow" });
    if (!res.ok) return `(landing page returned ${res.status})`;
    const html = await res.text();
    return stripHtml(html).slice(0, maxChars);
  } catch (e) {
    return `(could not fetch landing page: ${(e as Error).message})`;
  }
}

export function stripHtml(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1];
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(h[1-6]|p|li|br|div|section|article|tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  const head = [title ? `TITLE: ${title}` : "", metaDesc ? `DESCRIPTION: ${metaDesc}` : ""].filter(Boolean).join("\n");
  body = head ? `${head}\n\n${body}` : body;
  return body;
}
