import { redirect } from "next/navigation";
import { api, type Brand } from "@/lib/api";
import { createBrief } from "../actions";

export const dynamic = "force-dynamic";

export default async function BriefPage() {
  const brands = await api<Brand[]>("/brands");
  async function submit(form: FormData) {
    "use server";
    const id = await createBrief(form);
    redirect(`/campaigns/${id}`);
  }
  return (
    <>
      <h1>New brief</h1>
      <form className="stack" action={submit}>
        <label>Brand</label>
        <select name="brand" required>{brands.map((b) => <option key={b.id} value={b.slug}>{b.name}{b.active ? "" : " (inactive)"}</option>)}</select>
        <label>Objective (blank = brand default)</label>
        <select name="objective"><option value="">default</option><option>OUTCOME_LEADS</option><option>OUTCOME_TRAFFIC</option></select>
        <label>Landing URL (blank = brand default)</label>
        <input name="landing_url" type="url" />
        <label>Offer or angle (optional)</label>
        <input name="offer" />
        <label>Number of creatives</label>
        <input name="creatives" type="number" defaultValue={4} min={1} max={12} />
        <label>Duration (days)</label>
        <input name="duration_days" type="number" defaultValue={7} min={1} max={90} />
        <label>Total budget for the run (brand currency)</label>
        <input name="total_budget" type="number" step="0.01" required />
        <p className="muted">Generation takes 1 to 3 minutes. Nothing goes to Meta until you approve.</p>
        <button className="primary" type="submit">Generate draft</button>
      </form>
    </>
  );
}
