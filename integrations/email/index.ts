import "server-only";
import { AppError } from "@/domain/errors";
import { emailConfig, missingEmailEnv } from "@/lib/env";
import { createResendEmail } from "./resend";
import type { EmailSender } from "./types";

/**
 * Provider: Resend (approved by Mark). When RESEND_API_KEY and EMAIL_FROM are both set, sign-in
 * links go out through Resend. ASSUMPTION: without them, development logs the link to the server
 * console so the flow stays testable, and production fails with PROVIDER_UNAVAILABLE (naming the
 * missing variables in the server log) instead of silently dropping the link.
 */
export const devConsoleEmail: EmailSender = {
  name: "dev-console",
  async sendSignInLink({ to, url }) {
    console.info(JSON.stringify({ level: "info", msg: "dev_sign_in_link", to, url }));
  },
};

export const unavailableEmail: EmailSender = {
  name: "unavailable",
  async sendSignInLink() {
    console.error(JSON.stringify({ level: "error", msg: "email_not_configured", missing: missingEmailEnv() }));
    throw new AppError("PROVIDER_UNAVAILABLE", "Email sign-in isn't set up yet");
  },
};

export function getEmailSender(): EmailSender {
  const config = emailConfig();
  if (config) return createResendEmail(config);
  return process.env.NODE_ENV === "production" ? unavailableEmail : devConsoleEmail;
}
