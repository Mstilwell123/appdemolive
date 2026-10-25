import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/env";
import { checkOpenAIKey, getProviders } from "@/services/providers";
import { getStorage } from "@/integrations/storage";

export const dynamic = "force-dynamic";

/** Liveness plus which integrations are real vs mocked. Never returns secrets. */
export async function GET() {
  const ai = await checkOpenAIKey();
  const p = getProviders(); // Phase 1: every provider is a labeled mock
  return NextResponse.json({
    ok: true,
    database: isDatabaseConfigured() ? "configured" : "not_configured",
    storage: getStorage()?.name ?? "not_configured",
    providers: {
      ai,
      broadcast: p.broadcast.name,
      distribution: p.distribution.name,
      dm: p.dm.name,
      billing: p.billing.name,
    },
  });
}
