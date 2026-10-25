"use server";

import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { signup_intents, users } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export type AuthFormState = { status: "idle" | "sent" | "error"; message?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const safeNext = (n: string) => (n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard"); // no open redirects

/**
 * Emails a sign-in link. Signup first records the name and organization in signup_intents; the
 * database's handle_new_user trigger reads them when the account is created on first sign-in.
 * Login refuses unknown addresses so typos don't create accounts.
 */
export async function requestSignInLink(mode: "login" | "signup", _prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const auth = getAuth();
  const db = getDb();
  if (!auth || !db) return { status: "error", message: "Sign-in isn't connected yet." };

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return { status: "error", message: "Enter a valid email address." };
  const next = safeNext(String(form.get("next") ?? "/dashboard"));
  const fullName = String(form.get("full_name") ?? "").trim().slice(0, 120);

  try {
    if (mode === "signup") {
      const organizationName = String(form.get("organization_name") ?? "").trim().slice(0, 120);
      if (!fullName || !organizationName) return { status: "error", message: "Enter your name and company." };
      await db
        .insert(signup_intents)
        .values({ email, full_name: fullName, organization_name: organizationName })
        .onConflictDoUpdate({ target: signup_intents.email, set: { full_name: fullName, organization_name: organizationName, created_at: sql`now()` } });
    } else {
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (!existing) return { status: "error", message: "We couldn't send a link. Check the address, or sign up if you're new." };
    }
    await auth.api.signInMagicLink({
      body: { email, name: mode === "signup" ? fullName : undefined, callbackURL: next, errorCallbackURL: "/login?error=link" },
      headers: await headers(),
    });
  } catch (e) {
    if (e instanceof AppError && e.code === "PROVIDER_UNAVAILABLE") return { status: "error", message: "Email sign-in isn't set up yet." };
    console.error(JSON.stringify({ level: "error", msg: "sign_in_link_failed", error: (e as Error).message }));
    return { status: "error", message: "We couldn't send a link. Please try again." };
  }
  return { status: "sent" };
}
