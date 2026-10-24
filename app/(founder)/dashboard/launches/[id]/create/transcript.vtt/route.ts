import { NextResponse } from "next/server";
import { AppError } from "@/domain/errors";
import { uuidSchema } from "@/schemas/launch";
import { getTranscriptVtt } from "@/services/content-pack-files";

/** The ready recording's transcript as WebVTT, for the assembled content pack. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const vtt = await getTranscriptVtt(uuidSchema.parse(id));
    return new NextResponse(vtt, { headers: { "content-type": "text/vtt; charset=utf-8", "content-disposition": 'attachment; filename="transcript.vtt"', "cache-control": "private, no-store" } });
  } catch (e) {
    const status = e instanceof AppError ? ({ UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404 } as Record<string, number>)[e.code] ?? 400 : 500;
    return new NextResponse(status === 500 ? "Something went wrong" : (e as Error).message, { status });
  }
}
