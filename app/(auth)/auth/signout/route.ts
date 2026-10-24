import { NextResponse, type NextRequest } from "next/server";
import { getUserClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await getUserClient();
  await supabase?.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
