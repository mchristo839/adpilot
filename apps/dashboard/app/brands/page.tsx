import { api, money, type Brand } from "@/lib/api";
import { saveBrand } from "../actions";

export const dynamic = "force-dynamic";

function BrandForm({ b }: { b: Brand | null }) {
  const action = saveBrand.bind(null, b?.id ?? null);
  return (
    <form className="stack card" action={action}>
      <b>{b ? b.name : "Add brand"}</b>
      {!b && <><label>Slug</label><input name="slug" required pattern="[a-z0-9-]+" /></>}
      <label>Name</label><input name="name" defaultValue={b?.name} required />
      <label>Ad account id (act_...)</label><input name="ad_account_id" defaultValue={b?.ad_account_id} required />
      <label>Page id</label><input name="page_id" defaultValue={b?.page_id} required />
      <label>Instagram actor id</label><input name="instagram_actor_id" defaultValue={b?.instagram_actor_id ?? ""} />
      <label>Pixel id</label><input name="pixel_id" defaultValue={b?.pixel_id ?? ""} />
      <label>Default objective</label>
      <select name="default_objective" defaultValue={b?.default_objective ?? "OUTCOME_TRAFFIC"}><option>OUTCOME_LEADS</option><option>OUTCOME_TRAFFIC</option></select>
      <label>Landing URLs (one per line)</label><textarea name="landing_urls" defaultValue={b?.landing_urls.join("\n")} rows={2} />
      <label>Audience notes</label><textarea name="audience_notes" defaultValue={b?.audience_notes} rows={3} />
      <label>Tone rules</label><textarea name="tone_rules" defaultValue={b?.tone_rules} rows={3} />
      <label>Currency</label><input name="currency" defaultValue={b?.currency ?? "EUR"} maxLength={3} required />
      <label>Timezone</label><input name="timezone" defaultValue={b?.timezone ?? "Asia/Nicosia"} required />
      <label>Daily cap</label><input name="daily_cap" type="number" step="0.01" defaultValue={b ? b.daily_cap_cents / 100 : 10} />
      <label>Monthly cap</label><input name="monthly_cap" type="number" step="0.01" defaultValue={b ? b.monthly_cap_cents / 100 : 200} />
      <label>Max CPA (blank disables the CPA guard)</label><input name="max_cpa" type="number" step="0.01" defaultValue={b?.max_cpa_cents ? b.max_cpa_cents / 100 : ""} />
      {b && <label><input type="checkbox" name="active" defaultChecked={b.active} style={{ width: "auto" }} /> Active</label>}
      <p className="muted">Cap changes are written to the audit log.</p>
      <button className="primary" type="submit">{b ? "Save" : "Create (starts inactive)"}</button>
    </form>
  );
}

export default async function BrandsPage() {
  const brands = await api<Brand[]>("/brands");
  return (
    <>
      <h1>Brands</h1>
      <table>
        <thead><tr><th>Brand</th><th>Account</th><th>Objective</th><th>Daily cap</th><th>Monthly cap</th><th>Max CPA</th><th>Active</th></tr></thead>
        <tbody>
          {brands.map((b) => (
            <tr key={b.id}>
              <td>{b.name}</td><td>{b.ad_account_id}</td><td>{b.default_objective.replace("OUTCOME_", "")}</td>
              <td>{money(b.daily_cap_cents, b.currency)}</td><td>{money(b.monthly_cap_cents, b.currency)}</td>
              <td>{b.max_cpa_cents ? money(b.max_cpa_cents, b.currency) : "off"}</td>
              <td><span className={`badge ${b.active ? "ACTIVE" : ""}`}>{b.active ? "yes" : "no"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Edit</h2>
      <div className="grid">
        {brands.map((b) => <BrandForm key={b.id} b={b} />)}
        <BrandForm b={null} />
      </div>
    </>
  );
}
