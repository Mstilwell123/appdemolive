"use client";

import { useActionState } from "react";
import { requestSignInLink, type AuthFormState } from "@/app/(auth)/actions";

/** Email sign-in link. Signup also collects the name and organization used when the account is first created. */
export function AuthForm({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const [result, formAction, pending] = useActionState<AuthFormState, FormData>(requestSignInLink.bind(null, mode), { status: "idle" });
  const state = pending ? "sending" : result.status;
  const message = result.message ?? "";

  if (state === "sent") {
    return <p className="rounded-md bg-green-50 p-4 text-sm text-green-900">Check your email for a sign-in link.</p>;
  }

  return (
    <form action={formAction} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
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
