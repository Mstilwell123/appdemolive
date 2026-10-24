import "server-only";
import { Resend } from "resend";
import { AppError } from "@/domain/errors";
import type { EmailSender } from "./types";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function signInEmail(url: string) {
  const safe = escapeHtml(url);
  return {
    subject: "Your AppDemo.live sign-in link",
    text: `Sign in to AppDemo.live:\n\n${url}\n\nThis link expires soon. If you didn't request it, ignore this email.`,
    html: `<p>Sign in to AppDemo.live:</p><p><a href="${safe}">Sign in</a></p><p style="color:#666;font-size:12px">If the button doesn't work, paste this link: ${safe}<br/>If you didn't request it, ignore this email.</p>`,
  };
}

export function createResendEmail(config: { apiKey: string; from: string }): EmailSender {
  const client = new Resend(config.apiKey);
  return {
    name: "resend",
    async sendSignInLink({ to, url }) {
      let failure: string | null = null;
      try {
        const { error } = await client.emails.send({ from: config.from, to: [to], ...signInEmail(url) });
        if (error) failure = error.name ?? "resend_error";
      } catch (e) {
        failure = e instanceof Error ? e.name : "resend_exception";
      }
      if (failure) {
        // Log only the error kind; never the API key, the link, or the recipient.
        console.error(JSON.stringify({ level: "error", msg: "email_send_failed", provider: "resend", error: failure }));
        throw new AppError("PROVIDER_UNAVAILABLE", "We couldn't send the sign-in email. Please try again.");
      }
    },
  };
}
