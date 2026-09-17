import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (all) => {
        try {
          for (const { name, value, options } of all) store.set(name, value, options);
        } catch {
          /* called from a Server Component: middleware refreshes the session instead */
        }
      },
    },
  });
}

export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string | undefined | null): boolean {
  if (!email) return false;
  const list = allowedEmails();
  return list.length === 0 ? false : list.includes(email.toLowerCase());
}

/** Logged-in user's email, or null. */
export async function currentEmail(): Promise<string | null> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return data.user?.email?.toLowerCase() ?? null;
}
