import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const send = vi.fn();
const ctor = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
    constructor(key: string) {
      ctor(key);
    }
  },
}));

import { getEmailSender } from "@/integrations/email";
import { AppError } from "@/domain/errors";

const saved = { ...process.env };
beforeEach(() => {
  send.mockReset();
  ctor.mockReset();
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getEmailSender", () => {
  it("uses the dev console without keys outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const s = getEmailSender();
    expect(s.name).toBe("dev-console");
    await s.sendSignInLink({ to: "a@b.co", url: "http://x/l" });
    expect(send).not.toHaveBeenCalled();
  });

  it("fails clearly in production when keys are missing, naming the vars", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.RESEND_API_KEY = "re_test";
    const s = getEmailSender();
    expect(s.name).toBe("unavailable");
    await expect(s.sendSignInLink({ to: "a@b.co", url: "u" })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    const logged = String(vi.mocked(console.error).mock.calls[0][0]);
    expect(logged).toContain("EMAIL_FROM");
    expect(logged).not.toContain("re_test");
  });

  it("sends through Resend when configured", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "AppDemo <login@example.com>";
    send.mockResolvedValue({ data: { id: "1" }, error: null });
    const s = getEmailSender();
    expect(s.name).toBe("resend");
    await s.sendSignInLink({ to: "a@b.co", url: "https://app/x?t=1&y=<2>" });
    expect(ctor).toHaveBeenCalledWith("re_test");
    const p = send.mock.calls[0][0];
    expect(p.from).toBe("AppDemo <login@example.com>");
    expect(p.to).toEqual(["a@b.co"]);
    expect(p.text).toContain("https://app/x?t=1&y=<2>");
    expect(p.html).toContain("&amp;y=&lt;2&gt;");
    expect(p.html).not.toContain("<2>");
  });

  it("maps Resend errors and exceptions to PROVIDER_UNAVAILABLE without leaking the key", async () => {
    process.env.RESEND_API_KEY = "re_secret";
    process.env.EMAIL_FROM = "login@example.com";
    send.mockResolvedValueOnce({ data: null, error: { name: "validation_error", message: "domain not verified" } });
    send.mockRejectedValueOnce(new Error("network"));
    const s = getEmailSender();
    for (let i = 0; i < 2; i++) {
      const err = await s.sendSignInLink({ to: "a@b.co", url: "u" }).catch((e) => e);
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe("PROVIDER_UNAVAILABLE");
    }
    for (const c of vi.mocked(console.error).mock.calls) expect(String(c[0])).not.toContain("re_secret");
  });
});
