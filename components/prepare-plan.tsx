"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui";

/**
 * Shown while a paid launch is in PREPARATION. Starts plan generation once on load, shows
 * progress, and refreshes the page when the plan is ready. If another tab is already generating
 * (409), it waits and checks again instead of starting a second run.
 */
export function PreparePlan({ launchId, lastError }: { launchId: string; lastError: string | null }) {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<"working" | "waiting" | "error">(lastError ? "error" : "working");
  const [error, setError] = useState<string | null>(lastError);

  async function run() {
    setState("working");
    setError(null);
    try {
      const res = await fetch(`/api/v1/launches/${launchId}/prepare`, { method: "POST", headers: { "content-type": "application/json" } });
      const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string; message?: string };
      if (res.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent(`/dashboard/launches/${launchId}#plan`)}`);
        return;
      }
      if (res.status === 409 && body.error === "INVALID_STATE_TRANSITION" && body.message?.includes("already being built")) {
        setState("waiting");
        setTimeout(() => router.refresh(), 15_000);
        return;
      }
      if (!res.ok) throw new Error(body.message ?? "We couldn't build your plan. Please try again.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Network problem. Check your connection and try again.");
      setState("error");
    }
  }

  useEffect(() => {
    if (started.current || lastError) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "error") {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-700">{error}</p>
        <button type="button" onClick={run} className={buttonClass}>Try again</button>
      </div>
    );
  }
  return (
    <div aria-live="polite" className="flex items-center gap-3 text-slate-700">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" aria-hidden />
      <span>{state === "waiting" ? "Your plan is already being built. This page will update shortly." : "Building your launch strategy, likely customer questions and run-of-show. This usually takes about a minute."}</span>
    </div>
  );
}
