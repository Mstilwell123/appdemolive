import { NextResponse } from "next/server";
import { AppError } from "@/domain/errors";
import { uuidSchema } from "@/schemas/launch";
import { prepareLaunch } from "@/services/preparation";

export const dynamic = "force-dynamic";
// Four OpenAI calls (analysis, strategy, then questions and run-of-show in parallel) take about a minute.
export const maxDuration = 180;

/**
 * POST /api/v1/launches/:id/prepare
 * Generates the launch strategy, customer questions and run-of-show for a paid launch in
 * PREPARATION, then moves it to AWAITING_FOUNDER_APPROVAL. Safe to call twice: a second call
 * while one is running gets 409, and a call after it finished returns ready.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return NextResponse.json({ error: "VALIDATION_FAILED", message: "Invalid launch id" }, { status: 422 });

  // Same-origin only: this route acts on the signed-in user's cookies.
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!origin || !host || new URL(origin).host !== host) return NextResponse.json({ error: "FORBIDDEN", message: "Cross-site request" }, { status: 403 });

  try {
    return NextResponse.json(await prepareLaunch(id));
  } catch (e) {
    if (e instanceof AppError) {
      const message = e.code === "INTERNAL_ERROR" ? "Something went wrong. Please try again." : e.message;
      return NextResponse.json({ error: e.code, message }, { status: e.httpStatus });
    }
    console.error(JSON.stringify({ level: "error", msg: "prepare_route_failed", launchId: id, error: (e as Error).message }));
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Something went wrong. Please try again." }, { status: 500 });
  }
}
