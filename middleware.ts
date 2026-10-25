import { NextResponse, type NextRequest } from "next/server";

/**
 * Fast redirect for visitors with no session cookie. This is only a convenience: every page,
 * action and service still validates the session and org ownership on the server.
 */
// Better Auth's default session cookie (the __Secure- prefix is used over HTTPS).
const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

export function middleware(request: NextRequest) {
  if (!process.env.DATABASE_URL) return NextResponse.next(); // Unconfigured: pages render their own setup notice.
  if (!SESSION_COOKIES.some((name) => request.cookies.get(name)?.value)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/operator/:path*"],
};
