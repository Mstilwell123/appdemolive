import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { VISITOR_COOKIE } from "@/domain/tracked-links";
import { recordClick, resolveLink } from "@/services/tracked-links";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Tracked link redirect. Tracking failures never block the visitor; unknown slugs are a plain 404. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let link: Awaited<ReturnType<typeof resolveLink>> = null;
  try { link = await resolveLink(slug); } catch (e) { console.error(JSON.stringify({ level: "error", msg: "tracked_link_lookup_failed", error: e instanceof Error ? e.message : String(e) })); }
  if (!link) return new NextResponse("Not found", { status: 404, headers: { "x-robots-tag": "noindex" } });
  const existing = request.cookies.get(VISITOR_COOKIE)?.value;
  const visitor = existing && /^[0-9a-f-]{36}$/.test(existing) ? existing : randomUUID();
  await recordClick(link, visitor);
  const res = NextResponse.redirect(link.destination, { status: 302, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
  if (visitor !== existing) res.cookies.set(VISITOR_COOKIE, visitor, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365, path: "/r" });
  return res;
}
