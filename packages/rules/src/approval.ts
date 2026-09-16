/**
 * Rule 8: Approval required for all launches.
 * Nothing calls the Meta write endpoints until the campaign row has
 * approved_by and approved_at set.
 */
export interface ApprovalState {
  approved_by: string | null;
  approved_at: string | null;
}

export function isApproved(c: ApprovalState, approverName: string): boolean {
  return !!c.approved_by && c.approved_by === approverName && !!c.approved_at && !Number.isNaN(Date.parse(c.approved_at));
}

export function assertApproved(c: ApprovalState, approverName: string, campaignId: string): void {
  if (!isApproved(c, approverName)) {
    throw new Error(`Campaign ${campaignId} is not approved by ${approverName}. Refusing to publish (rule 8).`);
  }
}
