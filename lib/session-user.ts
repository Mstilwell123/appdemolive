import "server-only";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** The signed-in user from the Better Auth session cookie, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const auth = getAuth();
  if (!auth) return null;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}
