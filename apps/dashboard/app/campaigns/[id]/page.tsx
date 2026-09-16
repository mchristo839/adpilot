import { api, money, type Campaign } from "@/lib/api";
import { ReviewPanel } from "./review-panel";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await api<Campaign>(`/campaigns/${id}`);
  const s = c.strategy_json;
  return (
    <>
      <h1>{c.name} <span className={`badge ${c.status}`}>{c.status}</span> {c.dry_run_mode && <span className="badge dry">DRY RUN</span>}</h1>
      <p className="muted">{c.brands.name} · {c.objective} · {c.landing_url}</p>
      {c.last_error && <div className="warn">Last error: {c.last_error}</div>}
      <div className="grid">
        <div className="card">
          <b>Budget</b>
          <div>{money(c.daily_budget_cents, c.brands.currency)} per day (brand daily cap {money(c.brands.daily_cap_cents, c.brands.currency)})</div>
          <div>Lifetime cap {c.lifetime_cap_cents ? money(c.lifetime_cap_cents, c.brands.currency) : "n/a"} · {c.start_date} to {c.end_date}</div>
          {c.approved_at && <div className="muted">Approved by {c.approved_by} at {c.approved_at}</div>}
        </div>
        {s && (
          <div className="card">
            <b>Targeting</b>
            <div>{s.targeting.countries.join(", ")} · ages {s.targeting.age_min} to {s.targeting.age_max} · {s.placements}</div>
            <div className="muted">Interests: {s.targeting.interests.join(", ") || "none"}</div>
            <div className="muted">{s.targeting.custom_notes}</div>
          </div>
        )}
        {s && (
          <div className="card">
            <b>Angles</b>
            {s.angles.map((a) => <div key={a.name}><b>{a.name}</b>: {a.hook}</div>)}
          </div>
        )}
      </div>
      <h2>Creatives</h2>
      <ReviewPanel campaign={c} />
    </>
  );
}
