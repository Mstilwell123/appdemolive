import "server-only";
import { notFound, redirect } from "next/navigation";
import { AppError } from "@/domain/errors";

/** Runs a page loader: sends signed-out users to login, unknown or other-tenant ids to 404, and returns null on other failures. */
export async function load<T>(path: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError && e.code === "UNAUTHORIZED") redirect(`/login?next=${encodeURIComponent(path)}`);
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    console.error(e);
    return null;
  }
}
