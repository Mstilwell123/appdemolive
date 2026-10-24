import { describe, expect, it } from "vitest";
import { CLICK_WINDOW_MS, clickWindow, metricText, metricsFor } from "@/domain/tracked-links";

describe("tracked link metrics", () => {
  it("disconnected sources are unavailable, never zero", () => {
    const m = metricsFor({ clicks: 0 });
    expect(m.find((x) => x.source === "clicks")).toMatchObject({ status: "connected", value: 0 });
    for (const x of m.filter((x) => x.source !== "clicks")) {
      expect(x).toMatchObject({ status: "unavailable", value: null });
      expect(metricText(x)).toMatch(/Unavailable/);
    }
    expect(metricsFor({}).every((x) => x.status === "unavailable")).toBe(true);
  });
  it("buckets clicks into 30-minute windows", () => {
    const t = new Date(Math.floor(Date.now() / CLICK_WINDOW_MS) * CLICK_WINDOW_MS);
    expect(clickWindow(new Date(t.getTime() + CLICK_WINDOW_MS - 1))).toBe(clickWindow(t));
    expect(clickWindow(new Date(t.getTime() + CLICK_WINDOW_MS))).toBe(clickWindow(t) + 1);
  });
});
