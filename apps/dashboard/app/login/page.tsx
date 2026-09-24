import { redirect } from "next/navigation";
import { isAllowed, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string; next?: string }> }) {
  const q = await searchParams;
  async function sendLink(form: FormData) {
    "use server";
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!isAllowed(email)) redirect("/login?error=not_allowed");
    const sb = await supabaseServer();
    const base = process.env.DASHBOARD_URL ?? process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "";
    const next = String(form.get("next") ?? "/");
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${base}/auth/callback?next=${encodeURIComponent(next)}` } });
    if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
    redirect("/login?sent=1");
  }
  return (
    <div style={{ maxWidth: 420, margin: "80px auto" }}>
      <h1>AdPilot</h1>
      {q.sent ? (
        <p>Check your inbox. The login link is valid for a few minutes and opens the dashboard.</p>
      ) : (
        <form className="stack" action={sendLink}>
          <label>Email</label>
          <input name="email" type="email" required autoFocus />
          <input type="hidden" name="next" value={q.next ?? "/"} />
          {q.error === "not_allowed" && <p className="warn">That address is not on the approver list.</p>}
          {q.error && q.error !== "not_allowed" && <p className="warn">{q.error}</p>}
          <button className="primary" type="submit" style={{ marginTop: 12 }}>Send login link</button>
          <p className="muted">Only addresses listed in ALLOWED_EMAILS can sign in. Approvals are recorded under this address.</p>
        </form>
      )}
    </div>
  );
}
