/** Login allowlist from ALLOWED_EMAILS. No server-only imports so middleware can use it too. */
export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string | undefined | null): boolean {
  if (!email) return false;
  return allowedEmails().includes(email.toLowerCase());
}
