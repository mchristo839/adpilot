"use client";
import { useState, useTransition } from "react";
import type { Campaign } from "@/lib/api";
import { approveAndLaunch, discard, regenerate, setCreativeStatus } from "../../actions";

export function ReviewPanel({ campaign }: { campaign: Campaign }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const reviewable = ["DRAFT", "PENDING_APPROVAL", "FAILED"].includes(campaign.status);
  const approvedIds = campaign.creatives.filter((c) => c.status === "approved").map((c) => c.id);
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  return (
    <>
      {error && <div className="warn">{error}</div>}
      <div className="grid">
        {campaign.creatives.map((cr) => (
          <div className="card" key={cr.id}>
            {cr.image_url ? <img src={cr.image_url} alt={cr.headline} /> : <div className="muted">No image rendered</div>}
            <div className="row" style={{ marginTop: 8 }}>
              <span className={`badge ${cr.status}`}>{cr.status}</span>
              <span className="muted">{cr.angle} · {cr.cta}</span>
            </div>
            <p><b>{cr.headline}</b></p>
            <p style={{ whiteSpace: "pre-wrap" }}>{cr.primary_text}</p>
            <p className="muted">{cr.description}</p>
            <details><summary className="muted">Variants</summary>
              <ul>{cr.primary_text_variants.map((v, i) => <li key={i}>{v}</li>)}</ul>
              <ul>{cr.headline_variants.map((v, i) => <li key={i}>{v}</li>)}</ul>
            </details>
            {reviewable && (
              <div className="row">
                <button className="small primary" disabled={pending} onClick={() => run(() => setCreativeStatus(campaign.id, cr.id, "approved"))}>Approve</button>
                <button className="small" disabled={pending} onClick={() => run(() => setCreativeStatus(campaign.id, cr.id, "rejected"))}>Reject</button>
                <button className="small" disabled={pending} onClick={() => run(() => regenerate(campaign.id, cr.id, "copy"))}>Regen copy</button>
                <button className="small" disabled={pending} onClick={() => run(() => regenerate(campaign.id, cr.id, "image"))}>Regen image</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {reviewable && (
        <div className="row" style={{ marginTop: 20 }}>
          <button
            className="primary"
            disabled={pending || approvedIds.length === 0}
            onClick={() => {
              if (!confirm(`Launch ${approvedIds.length} approved creative(s) at ${(campaign.daily_budget_cents / 100).toFixed(2)} ${campaign.brands.currency}/day?${campaign.dry_run_mode ? " (DRY RUN: nothing will be sent to Meta)" : ""}`)) return;
              run(() => approveAndLaunch(campaign.id, approvedIds));
            }}
          >
            {pending ? "Working..." : `Approve and launch (${approvedIds.length})`}
          </button>
          <button className="danger" disabled={pending} onClick={() => confirm("Discard this draft?") && run(() => discard(campaign.id))}>Discard</button>
        </div>
      )}
    </>
  );
}
