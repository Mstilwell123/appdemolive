import { createHash } from "node:crypto";

/**
 * Safe tracked CTA for the PUBLIC EXAMPLE campaign (PRD v1.4 §117, R1).
 * - Logs an "example_click" event that is never a conversion (countsAsConversion: false).
 * - Duplicate clicks from the same browser within the window are flagged, so they're counted once.
 * - Always redirects, even if logging throws.
 * - Only redirects to a fixed same-site destination (no open redirect).
 * Logging goes to the structured server log (Vercel/stdout). It deliberately writes nothing to the
 * production database; a persisted tracked_link_clicks table belongs to R7.
 */
export const EXAMPLE_CTA_DESTINATION = "/?example_click=1#stage-measure";
export const EXAMPLE_CTA_COOKIE = "ad_example_click";
const DEDUPE_SECONDS = 60 * 30;

export interface ExampleClickEvent {
  type: "example_click";
  campaign: "invoicepilot-example";
  placement: string;
  duplicate: boolean;
  countsAsConversion: false;
  visitorHash: string;
  at: string;
}
export type ClickLogger = (e: ExampleClickEvent) => void | Promise<void>;

export const defaultClickLogger: ClickLogger = (e) => {
  console.info(JSON.stringify({ level: "info", msg: "example_cta_click", ...e }));
};

const PLACEMENTS = new Set(["promote", "measure", "hero", "clip"]);

export async function handleExampleClick(request: Request, log: ClickLogger = defaultClickLogger): Promise<Response> {
  const url = new URL(request.url);
  const raw = url.searchParams.get("p") ?? "promote";
  const placement = PLACEMENTS.has(raw) ? raw : "other";
  const cookies = request.headers.get("cookie") ?? "";
  const duplicate = cookies.split(/;\s*/).some((c) => c.startsWith(`${EXAMPLE_CTA_COOKIE}=`));
  const ua = request.headers.get("user-agent") ?? "";
  const visitorHash = createHash("sha256").update(ua).digest("hex").slice(0, 12); // no IPs, no raw identifiers
  try {
    await log({ type: "example_click", campaign: "invoicepilot-example", placement, duplicate, countsAsConversion: false, visitorHash, at: new Date().toISOString() });
  } catch {
    // Logging must never block the visitor.
  }
  const headers = new Headers({
    location: new URL(EXAMPLE_CTA_DESTINATION, url.origin).toString(),
    "cache-control": "no-store",
    "x-robots-tag": "noindex",
  });
  if (!duplicate) headers.append("set-cookie", `${EXAMPLE_CTA_COOKIE}=1; Path=/; Max-Age=${DEDUPE_SECONDS}; SameSite=Lax; HttpOnly`);
  return new Response(null, { status: 303, headers });
}
