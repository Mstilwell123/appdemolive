import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { env, isSupabaseConfigured, serviceRoleKey } from "@/lib/env";

/** Supabase client acting as the signed-in user (RLS applies). Null when Supabase isn't configured. */
export async function getUserClient() {
  if (!isSupabaseConfigured()) return null;
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only; middleware refreshes the session.
        }
      },
    },
  });
}

/** Service-role client (bypasses RLS). Server code must authorize the caller before using it. */
export function getServiceClient() {
  const key = serviceRoleKey();
  if (!isSupabaseConfigured() || !key) return null;
  return createClient(env.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
