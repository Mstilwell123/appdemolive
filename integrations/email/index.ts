import "server-only";
import { AppError } from "@/domain/errors";
import type { EmailSender } from "./types";

/**
 * ASSUMPTION: no email provider is approved yet. In development the sign-in link is written to
 * the server console so the flow can be tested locally; in production sending fails with
 * PROVIDER_UNAVAILABLE instead of silently dropping the link. Plug an approved provider in here.
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
    throw new AppError("PROVIDER_UNAVAILABLE", "Email sign-in isn't set up yet");
  },
};

export function getEmailSender(): EmailSender {
  return process.env.NODE_ENV === "production" ? unavailableEmail : devConsoleEmail;
}
