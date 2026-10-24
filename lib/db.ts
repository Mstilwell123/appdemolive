import "server-only";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import ws from "ws";
import * as schema from "@/db/schema";
import { AppError } from "@/domain/errors";
import { databaseUrl } from "@/lib/env";

/** Any Drizzle Postgres database or transaction over the app schema (Neon in the app, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let cached: Db | null = null;
let injected: Db | null = null;

/** Tests swap in an in-memory database. Never called by app code. */
export function setDbForTests(db: Db | null) {
  injected = db;
}

/**
 * Neon over WebSockets (Pool), so interactive transactions work. Node has no global WebSocket
 * before v22, so the ws package fills in. Null when DATABASE_URL isn't set.
 */
export function getDb(): Db | null {
  if (injected) return injected;
  const url = databaseUrl();
  if (!url) return null;
  if (!cached) {
    if (typeof WebSocket === "undefined") neonConfig.webSocketConstructor = ws;
    cached = drizzle({ client: new Pool({ connectionString: url }), schema }) as unknown as Db;
  }
  return cached;
}

export function requireDb(): Db {
  const db = getDb();
  if (!db) throw new AppError("PROVIDER_UNAVAILABLE", "The database is not configured");
  return db;
}

/**
 * Runs fn in a transaction with app.user_id set to the acting user, which the database functions
 * read through public.app_user_id() (the replacement for Supabase's auth.uid()). Callers must have
 * authorized the user for the rows involved first.
 */
export async function withActor<T>(db: Db, userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx as unknown as Db);
  });
}

/** Postgres error message from a failed query (Drizzle wraps the driver error as `cause`). */
export function dbErrorMessage(e: unknown): string {
  const err = e as { cause?: { message?: string }; message?: string };
  return err?.cause?.message ?? err?.message ?? "";
}

/** Postgres SQLSTATE of a failed query, e.g. 23505 for a unique violation. */
export function dbErrorCode(e: unknown): string | undefined {
  const err = e as { cause?: { code?: string }; code?: string };
  return err?.cause?.code ?? err?.code;
}

/** Rows of a raw SQL query (database function calls). */
export async function queryRows<T>(db: Db, query: SQL): Promise<T[]> {
  const res = (await db.execute(query)) as unknown as { rows: T[] };
  return res.rows;
}
