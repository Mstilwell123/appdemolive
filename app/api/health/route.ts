import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { getProviders } from "@/services/providers";

export const dynamic = "force-dynamic";

/** Liveness plus which integrations are real vs mocked. Never returns secrets. */
export function GET() {
  const p = getProviders(); // Phase 1: every provider is a labeled mock
  return NextResponse.json({
    ok: true,
    supabase: isSupabaseConfigured() ? "configured" : "not_configured",
    providers: {
      ai: "mock",
      broadcast: p.broadcast.name,
      distribution: p.distribution.name,
      dm: p.dm.name,
      billing: p.billing.name,
    },
  });
}
