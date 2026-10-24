import { NextResponse, type NextRequest } from "next/server";
import { getUserClient } from "@/lib/supabase/server";

/** Exchanges the emailed sign-in code for a session, then sends the user to the dashboard. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/dashboard";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard"; // no open redirects
  const supabase = await getUserClient();
  if (!supabase || !code) return NextResponse.redirect(new URL("/login?error=link", url.origin));
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=link", url.origin));
  return NextResponse.redirect(new URL(next, url.origin));
}
