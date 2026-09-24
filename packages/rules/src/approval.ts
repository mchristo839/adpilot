/**
 * Rule 8: Approval required for all launches.
 * Nothing calls the Meta write endpoints until the campaign row has
 * approved_by and approved_at set.
 */
export interface ApprovalState {
  approved_by: string | null;
  approved_at: string | null;
}

export function isApproved(c: ApprovalState, approver: string | string[]): boolean {
  const allowed = (Array.isArray(approver) ? approver : [approver]).map((a) => a.trim().toLowerCase()).filter(Boolean);
  const by = (c.approved_by ?? "").trim().toLowerCase();
  return !!by && allowed.includes(by) && !!c.approved_at && !Number.isNaN(Date.parse(c.approved_at));
}

export function assertApproved(c: ApprovalState, approver: string | string[], campaignId: string): void {
  if (!isApproved(c, approver)) {
    const who = Array.isArray(approver) ? approver.join(", ") : approver;
    throw new Error(`Campaign ${campaignId} is not approved by an allowed approver (${who}). Refusing to publish (rule 8).`);
  }
}
