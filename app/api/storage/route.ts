import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { NextResponse, type NextRequest } from "next/server";
import { getStorage, readStream, safeKey, verify, writeStream } from "@/integrations/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Local storage adapter endpoint. Every request needs an unexpired HMAC signature minted by the server after an ownership check. */
function check(req: NextRequest, op: "put" | "get") {
  const p = req.nextUrl.searchParams;
  const key = safeKey(p.get("key") ?? "");
  const exp = Number(p.get("exp"));
  const max = p.get("max");
  if (!key || p.get("op") !== op) return null;
  if (!verify(op, key, exp, p.get("sig") ?? "", op === "put" ? `max=${max ?? ""}` : "")) return null;
  return { key, max: Number(max) };
}

export async function PUT(req: NextRequest) {
  if (getStorage()?.name !== "local") return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  const ok = check(req, "put");
  if (!ok) return NextResponse.json({ error: "Invalid or expired upload link" }, { status: 403 });
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > ok.max) return NextResponse.json({ error: "File too large" }, { status: 413 });
  if (!req.body) return NextResponse.json({ error: "Empty upload" }, { status: 400 });
  try {
    const size = await writeStream(ok.key, req.body as unknown as WebReadableStream<Uint8Array>, ok.max);
    return NextResponse.json({ ok: true, size });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "TOO_LARGE") return NextResponse.json({ error: "File too large" }, { status: 413 });
    if (msg === "EMPTY") return NextResponse.json({ error: "Empty upload" }, { status: 400 });
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const storage = getStorage();
  if (storage?.name !== "local") return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  const ok = check(req, "get");
  if (!ok) return NextResponse.json({ error: "Invalid or expired link" }, { status: 403 });
  const found = await storage.exists(ok.key);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new Response(readStream(ok.key), {
    headers: { "content-type": "application/octet-stream", "content-length": String(found.size), "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="${ok.key.split("/").pop()}"`, "x-content-type-options": "nosniff" },
  });
}
