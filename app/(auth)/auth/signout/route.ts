import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";

/** Ends the Better Auth session (deletes it server-side and clears the cookie), then goes home. */
export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  const auth = getAuth();
  if (!auth) return response;
  try {
    const res = await auth.api.signOut({ headers: request.headers, asResponse: true });
    for (const cookie of res.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
  } catch {
    // No session to end: still send the visitor home.
  }
  return response;
}
