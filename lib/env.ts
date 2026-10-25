/** Central env access. Missing provider keys fall back to labeled mocks so the app runs without them. */
export const env = {
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
};

/** Server-only. The Neon (or any Postgres) connection string. Never import from a client component. */
export function databaseUrl(): string | null {
  if (typeof window !== "undefined") throw new Error("databaseUrl() called in the browser");
  return process.env.DATABASE_URL || null;
}

/** Server-only. Better Auth signs session cookies with this secret. */
export function authSecret(): string | null {
  if (typeof window !== "undefined") throw new Error("authSecret() called in the browser");
  return process.env.BETTER_AUTH_SECRET || null;
}

/** Accounts and launches need both the database and the auth secret. */
export function isDatabaseConfigured(): boolean {
  return Boolean(databaseUrl() && authSecret());
}

/** Server-only. Resend credentials for transactional email; null when either is missing. */
export function emailConfig(): { apiKey: string; from: string } | null {
  if (typeof window !== "undefined") throw new Error("emailConfig() called in the browser");
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  return apiKey && from ? { apiKey, from } : null;
}

/** Names of the email env vars that are not set, for clear error messages (never values). */
export function missingEmailEnv(): string[] {
  return (["RESEND_API_KEY", "EMAIL_FROM"] as const).filter((k) => !process.env[k]);
}
