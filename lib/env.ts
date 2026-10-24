/** Central env access. Missing provider keys fall back to labeled mocks so the app runs without them. */
export const env = {
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};

export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}

/** Server-only. Never import from a client component. */
export function serviceRoleKey(): string | null {
  if (typeof window !== "undefined") throw new Error("serviceRoleKey() called in the browser");
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}
