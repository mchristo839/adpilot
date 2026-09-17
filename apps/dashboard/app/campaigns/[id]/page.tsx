import { api, money, type Campaign } from "@/lib/api";
import { retryGeneration } from "../../actions";
import { AutoRefresh } from "./auto-refresh";
import { ReviewPanel } from "./review-panel";

export const dynamic = "force-dynamic";

function fmtAudience(lo?: number, hi?: number): string {
  if (!lo && !hi) return "";
  const f = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  return ` (${f(lo ?? 0)} to ${f(hi ?? lo ?? 0)})`;
}

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await api<Campaign>(`/campaigns/${id}`);
  const s = c.strategy_json;
  const generating = c.status === "GENERATING" || c.creatives.some((cr) => cr.generating);
  const retry = retryGeneration.bind(null, c.id);
  return (
    <>
      <h1>{c.name} <span className={`badge ${c.status}`}>{c.status}</span> {c.dry_run_mode && <span className="badge dry">DRY RUN</span>}</h1>
      <p className="muted">{c.brands.name} · {c.objective} · {c.landing_url}</p>
      <AutoRefresh active={generating} />
      {c.last_error && <div className="warn">Last error: {c.last_error}</div>}
      {c.generation_error && (
        <div className="warn">
          Generation failed: {c.generation_error}{" "}
          <form action={retry} style={{ display: "inline" }}><button className="small" type="submit">Retry generation</button></form>
        </div>
      )}
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
            <div>{s.targeting.countries.join(", ")} · ages {s.targeting.age_min} to {s.targeting.age_max} · {s.placements === "advantage_plus" ? "Advantage+ audience" : "manual placements"}</div>
            <div style={{ marginTop: 6 }}><b>Meta interests that will ship</b></div>
            {s.resolved_interests?.length ? (
              <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                {s.resolved_interests.map((i) => (
                  <li key={i.id}>{i.name}<span className="muted">{fmtAudience(i.audience_size_lower_bound, i.audience_size_upper_bound)}{i.query.toLowerCase() !== i.name.toLowerCase() ? ` · asked for "${i.query}"` : ""}</span></li>
                ))}
              </ul>
            ) : (
              <div className="muted">none (broad targeting)</div>
            )}
            {!!s.unresolved_interests?.length && <div className="muted">Not found on Meta, dropped: {s.unresolved_interests.join(", ")}</div>}
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
      {c.status === "GENERATING" && !c.creatives.length ? <p className="muted">Nothing to review yet.</p> : <ReviewPanel campaign={c} />}
    </>
  );
}
