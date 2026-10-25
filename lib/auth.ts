import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import * as schema from "@/db/schema";
import { getEmailSender } from "@/integrations/email";
import { getDb, type Db } from "@/lib/db";
import { authSecret, env } from "@/lib/env";

const ts = { createdAt: "created_at", updatedAt: "updated_at" } as const;

/** Better Auth on our own tables (users, auth_sessions, auth_accounts, auth_verifications). Email magic links only. */
export function createAuth(db: Db, secret: string) {
  return betterAuth({
    baseURL: env.appUrl,
    secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        users: schema.users,
        auth_sessions: schema.auth_sessions,
        auth_accounts: schema.auth_accounts,
        auth_verifications: schema.auth_verifications,
      },
    }),
    user: { modelName: "users", fields: { emailVerified: "email_verified", ...ts } },
    session: {
      modelName: "auth_sessions",
      fields: { userId: "user_id", expiresAt: "expires_at", ipAddress: "ip_address", userAgent: "user_agent", ...ts },
    },
    account: {
      modelName: "auth_accounts",
      fields: {
        userId: "user_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        ...ts,
      },
    },
    verification: { modelName: "auth_verifications", fields: { expiresAt: "expires_at", ...ts } },
    advanced: { database: { generateId: "uuid" } },
    plugins: [
      magicLink({
        expiresIn: 15 * 60, // ASSUMPTION: sign-in links are valid for 15 minutes
        sendMagicLink: ({ email, url }) => getEmailSender().sendSignInLink({ to: email, url }),
      }),
      nextCookies(), // must stay last: lets server actions set the session cookie
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
let cached: Auth | null = null;

/** Null when the database or BETTER_AUTH_SECRET isn't configured. */
export function getAuth(): Auth | null {
  const db = getDb();
  const secret = authSecret();
  if (!db || !secret) return null;
  cached ??= createAuth(db, secret);
  return cached;
}
