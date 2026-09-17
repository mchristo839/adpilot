import { api, money, type Overview } from "@/lib/api";

export const dynamic = "force-dynamic";

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tone = pct >= 90 ? "var(--rust)" : pct >= 70 ? "var(--yellow)" : "#2f855a";
  return (
    <div style={{ margin: "6px 0" }}>
      <div className="row" style={{ justifyContent: "space-between" }}><span>{label}</span><span className="muted">{pct}%</span></div>
      <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label} style={{ height: 10, background: "#e5e7eb", borderRadius: 5, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: tone }} />
      </div>
    </div>
  );
}

function Ledger({ rows, currency }: { rows: { date: string; spend_cents: number }[]; currency: string }) {
  if (!rows.length) return <div className="muted">No spend recorded yet. The monitor loop fills this in.</div>;
  const max = Math.max(...rows.map((r) => r.spend_cents), 1);
  return (
    <div>
      <div className="muted">Daily spend, last 30 days ({currency})</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80, marginTop: 6 }} role="img" aria-label="Daily spend bars for the last 30 days">
        {rows.map((r) => (
          <div key={r.date} title={`${r.date}: ${(r.spend_cents / 100).toFixed(2)} ${currency}`} style={{ flex: 1, height: `${Math.max(2, Math.round((r.spend_cents / max) * 100))}%`, background: "var(--ink)", opacity: 0.85, borderRadius: 2 }} />
        ))}
      </div>
      <div className="row muted" style={{ justifyContent: "space-between", fontSize: 12 }}><span>{rows[0]?.date}</span><span>{rows[rows.length - 1]?.date}</span></div>
    </div>
  );
}

function Lines({ title, rows, currency, unit }: { title: string; rows: Overview["brands"][number]["best"]; currency: string; unit: string }) {
  return (
    <div>
      <b>{title}</b>
      {rows.length ? (
        <table style={{ marginTop: 4 }}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ad_id}>
                <td>{r.creative_id ? <a href={`/campaigns?creative=${r.creative_id}`}>{r.headline ?? r.ad_id}</a> : r.headline ?? r.ad_id}</td>
                <td className="muted">{money(r.spend_cents, currency)}</td>
                <td className="muted">{r.results} {unit}</td>
                <td>{r.cost_per_result_cents !== null ? money(r.cost_per_result_cents, currency) : "no results"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="muted">no data yet</div>
      )}
    </div>
  );
}

export default async function ReportsPage() {
  const o = await api<Overview>("/report/overview");
  const hours = o.last_monitor_run_at ? Math.round((Date.now() - Date.parse(o.last_monitor_run_at)) / 36e5) : null;
  return (
    <>
      <h1>Reports {o.dry_run && <span className="badge dry">DRY RUN</span>}</h1>
      <div className={o.monitor_stale ? "warn" : "muted"}>
        Last monitor run: {o.last_monitor_run_at ? `${o.last_monitor_run_at} (${hours}h ago)` : "never"}{o.monitor_stale ? ". Stale: check the n8n monitor workflow and the worker." : ""}
      </div>
      {o.brands.map((b) => (
        <div className="card" key={b.brand} style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>{b.name} {!b.active && <span className="badge">inactive</span>}</h2>
            <span className="muted">{b.active_campaigns} active campaign{b.active_campaigns === 1 ? "" : "s"} · yesterday {money(b.spend_yesterday_cents, b.currency)}</span>
          </div>
          <div className="grid" style={{ marginTop: 12 }}>
            <div>
              <Bar value={b.spend_mtd_cents} max={b.monthly_cap_cents} label={`Month to date ${money(b.spend_mtd_cents, b.currency)} of ${money(b.monthly_cap_cents, b.currency)}`} />
              <Bar value={b.active_daily_budget_cents} max={b.daily_cap_cents} label={`Active daily budget ${money(b.active_daily_budget_cents, b.currency)} of ${money(b.daily_cap_cents, b.currency)}`} />
            </div>
            <Ledger rows={b.ledger} currency={b.currency} />
            <Lines title="Best creatives (7 days)" rows={b.best} currency={b.currency} unit="results" />
            <Lines title="Worst creatives (7 days)" rows={b.worst} currency={b.currency} unit="results" />
          </div>
        </div>
      ))}
    </>
  );
}
