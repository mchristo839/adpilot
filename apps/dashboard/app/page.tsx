import { api, money, type Campaign } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function Home() {
  const campaigns = await api<(Campaign & { brands: { name: string; slug: string; currency: string } })[]>("/campaigns");
  const health = await api<{ dry_run: boolean; writes_allowed: boolean | null }>("/health").catch(() => null);
  return (
    <>
      <h1>Campaigns</h1>
      {health && (
        <div className="warn">
          Mode: <span className={`badge ${health.dry_run ? "dry" : ""}`}>{health.dry_run ? "DRY RUN (no Meta writes are sent)" : "LIVE"}</span>{" "}
          Token writes allowed: <b>{String(health.writes_allowed)}</b>
        </div>
      )}
      <table>
        <thead>
          <tr><th>Brand</th><th>Campaign</th><th>Objective</th><th>Status</th><th>Daily budget</th><th>Dates</th><th></th></tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id}>
              <td>{c.brands?.name}</td>
              <td><a href={`/campaigns/${c.id}`}>{c.name}</a>{c.dry_run && <> <span className="badge dry">dry</span></>}</td>
              <td>{c.objective.replace("OUTCOME_", "")}</td>
              <td><span className={`badge ${c.status}`}>{c.status}</span></td>
              <td>{money(c.daily_budget_cents, c.brands?.currency ?? "")}</td>
              <td className="muted">{c.start_date} to {c.end_date}</td>
              <td><a className="btn" href={`/campaigns/${c.id}`}>Review</a></td>
            </tr>
          ))}
          {!campaigns.length && <tr><td colSpan={7} className="muted">No campaigns yet. Create a brief.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
