"use client";

import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

/** Email sign-in link. Signup also collects the name and organization used by the handle_new_user trigger. */
export function AuthForm({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const supabase = getBrowserClient();

  if (!supabase) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Sign-in isn&apos;t connected yet. Add the Supabase keys from <code>.env.example</code> to enable it.
      </p>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === "sending") return; // ignore double submits
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setState("error");
      setMessage("Enter a valid email address.");
      return;
    }
    setState("sending");
    const redirect = new URL("/auth/callback", window.location.origin);
    if (next && next.startsWith("/")) redirect.searchParams.set("next", next);
    const { error } = await supabase!.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirect.toString(),
        shouldCreateUser: mode === "signup",
        data:
          mode === "signup"
            ? {
                full_name: String(form.get("full_name") ?? "").trim().slice(0, 120),
                organization_name: String(form.get("organization_name") ?? "").trim().slice(0, 120),
              }
            : undefined,
      },
    });
    if (error) {
      setState("error");
      setMessage(mode === "login" ? "We couldn't send a link. Check the address, or sign up if you're new." : "We couldn't send a link. Please try again.");
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return <p className="rounded-md bg-green-50 p-4 text-sm text-green-900">Check your email for a sign-in link.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === "signup" && (
        <>
          <label className="block text-sm">
            <span className="font-medium">Your name</span>
            <input name="full_name" required maxLength={120} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Company or product name</span>
            <input name="organization_name" required maxLength={120} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
        </>
      )}
      <label className="block text-sm">
        <span className="font-medium">Email</span>
        <input name="email" type="email" required className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
      </label>
      {state === "error" && <p className="text-sm text-red-600">{message}</p>}
      <button type="submit" disabled={state === "sending"} className="w-full rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
        {state === "sending" ? "Sending..." : mode === "signup" ? "Create account" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
