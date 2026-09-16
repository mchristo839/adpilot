"use server";
import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";

export async function setCreativeStatus(campaignId: string, creativeId: string, status: "approved" | "rejected" | "draft") {
  await api(`/campaigns/${campaignId}/creatives/${creativeId}/status`, { method: "POST", body: JSON.stringify({ status }) });
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function regenerate(campaignId: string, creativeId: string, part: "copy" | "image") {
  await api(`/campaigns/${campaignId}/creatives/${creativeId}/regenerate`, { method: "POST", body: JSON.stringify({ part }) });
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function approveAndLaunch(campaignId: string, creativeIds: string[]) {
  await api(`/campaigns/${campaignId}/approve`, { method: "POST", body: JSON.stringify({ creative_ids: creativeIds }) });
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/");
}

export async function discard(campaignId: string) {
  await api(`/campaigns/${campaignId}/discard`, { method: "POST" });
  revalidatePath("/");
}

export async function kill(brand: string) {
  const r = await api<{ paused: string[]; ms: number }>(`/kill`, { method: "POST", body: JSON.stringify({ brand }) });
  revalidatePath("/");
  return r;
}

export async function createBrief(form: FormData) {
  const body = {
    brand: String(form.get("brand")),
    objective: form.get("objective") ? String(form.get("objective")) : undefined,
    landing_url: form.get("landing_url") ? String(form.get("landing_url")) : undefined,
    offer: form.get("offer") ? String(form.get("offer")) : undefined,
    creatives: Number(form.get("creatives") ?? 4),
    duration_days: Number(form.get("duration_days") ?? 7),
    total_budget: Number(form.get("total_budget")),
  };
  const c = await api<{ id: string }>("/brief", { method: "POST", body: JSON.stringify(body) });
  revalidatePath("/");
  return c.id;
}

export async function saveBrand(id: string | null, form: FormData) {
  const num = (k: string) => (form.get(k) === "" || form.get(k) === null ? undefined : Number(form.get(k)));
  const str = (k: string) => (form.get(k) === null ? undefined : String(form.get(k)));
  const body: Record<string, unknown> = {
    name: str("name"),
    slug: str("slug"),
    ad_account_id: str("ad_account_id"),
    page_id: str("page_id"),
    instagram_actor_id: str("instagram_actor_id") || null,
    pixel_id: str("pixel_id") || null,
    default_objective: str("default_objective"),
    landing_urls: String(form.get("landing_urls") ?? "").split(/\s+/).filter(Boolean),
    audience_notes: str("audience_notes"),
    tone_rules: str("tone_rules"),
    currency: str("currency"),
    timezone: str("timezone"),
    monthly_cap: num("monthly_cap"),
    daily_cap: num("daily_cap"),
    max_cpa: form.get("max_cpa") === "" ? null : num("max_cpa"),
  };
  if (id) {
    delete body.slug;
    body.active = form.get("active") === "on";
    await api(`/brands/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  } else {
    await api(`/brands`, { method: "POST", body: JSON.stringify(body) });
  }
  revalidatePath("/brands");
}
