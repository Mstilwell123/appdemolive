import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const unavailable = () => NextResponse.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "Sign-in isn't set up yet" } }, { status: 503 });

/** Better Auth endpoints (magic-link verify, session, sign-out). */
export async function GET(request: Request) {
  const auth = getAuth();
  return auth ? toNextJsHandler(auth).GET(request) : unavailable();
}

export async function POST(request: Request) {
  const auth = getAuth();
  return auth ? toNextJsHandler(auth).POST(request) : unavailable();
}
