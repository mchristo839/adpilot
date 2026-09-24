import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, req.url));
  }
  // Same-origin paths only: "//host" and "/\host" are protocol-relative and would leave the site.
  const safe = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
  return NextResponse.redirect(new URL(safe, req.url));
}
