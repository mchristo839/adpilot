/**
 * Rule 10: Dry run mode.
 * DRY_RUN=true logs every intended Meta write without sending it.
 * Default on. Only the literal string "false" (case-insensitive) turns it off.
 */
export function isDryRun(env: Record<string, string | undefined>): boolean {
  const v = (env.DRY_RUN ?? "true").trim().toLowerCase();
  return v !== "false";
}
