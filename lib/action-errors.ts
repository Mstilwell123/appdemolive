import "server-only";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { AppError } from "@/domain/errors";

/** Turns a failure into a redirect back to the form with a safe, human message. Never returns. */
export function failTo(path: string, e: unknown): never {
  if (e instanceof AppError && e.code === "UNAUTHORIZED") redirect(`/login?next=${encodeURIComponent(path)}`);
  let message = "Something went wrong. Please try again.";
  if (e instanceof ZodError) message = e.issues.map((i) => i.message).join(". ");
  else if (e instanceof AppError && e.code !== "INTERNAL_ERROR") message = e.message;
  else console.error(e); // unexpected: log server-side, show a generic message
  const [base, hash] = path.split("#");
  const sep = base.includes("?") ? "&" : "?";
  redirect(`${base}${sep}error=${encodeURIComponent(message.slice(0, 300))}${hash ? `#${hash}` : ""}`);
}

/** Reads a string field from FormData ("" when missing). */
export function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}
