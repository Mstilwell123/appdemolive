"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui";

/** Buy button: asks the server for a Stripe Checkout URL, then sends the browser there. */
export function CheckoutButton({ launchId, label }: { launchId: string; label: string }) {
  const [state, setState] = useState<"idle" | "loading" | "redirecting">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`/api/v1/launches/${launchId}/checkout`, { method: "POST", headers: { "content-type": "application/json" } });
      const body = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (res.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent(`/dashboard/launches/${launchId}#payment`)}`);
        return;
      }
      if (!res.ok || !body.url) throw new Error(body.message ?? "We couldn't open checkout. Please try again.");
      setState("redirecting");
      window.location.assign(body.url);
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Network problem. Check your connection and try again.");
      setState("idle");
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button type="button" onClick={onClick} disabled={state !== "idle"} aria-busy={state !== "idle"} className={buttonClass}>
        {state === "idle" ? label : state === "loading" ? "Opening checkout…" : "Redirecting to Stripe…"}
      </button>
      {error && <p role="alert" className="max-w-xs text-right text-sm text-red-700">{error}</p>}
    </div>
  );
}
