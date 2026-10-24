import { describe, expect, it } from "vitest";
import { EXAMPLE_CTA_COOKIE, handleExampleClick, type ExampleClickEvent } from "@/lib/example-cta";
import { GET } from "@/app/r/example/route";

const req = (url = "https://appdemo.live/r/example?p=promote", headers: Record<string, string> = {}) => new Request(url, { headers });

describe("example tracked CTA", () => {
  it("logs a non-conversion click and redirects same-site", async () => {
    const events: ExampleClickEvent[] = [];
    const res = await handleExampleClick(req(), (e) => { events.push(e); });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://appdemo.live/?example_click=1#stage-measure");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "example_click", placement: "promote", duplicate: false, countsAsConversion: false });
    expect(res.headers.get("set-cookie")).toContain(`${EXAMPLE_CTA_COOKIE}=1`);
  });
  it("still redirects when logging throws or rejects", async () => {
    const a = await handleExampleClick(req(), () => { throw new Error("log down"); });
    const b = await handleExampleClick(req(), async () => { throw new Error("log down"); });
    for (const r of [a, b]) { expect(r.status).toBe(303); expect(r.headers.get("location")).toContain("/?example_click=1"); }
  });
  it("flags duplicates so they count once, and does not reset the cookie", async () => {
    const events: ExampleClickEvent[] = [];
    const res = await handleExampleClick(req(undefined, { cookie: `x=1; ${EXAMPLE_CTA_COOKIE}=1` }), (e) => { events.push(e); });
    expect(events[0].duplicate).toBe(true);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("is not an open redirect and normalizes unknown placements", async () => {
    const events: ExampleClickEvent[] = [];
    const res = await handleExampleClick(req("https://appdemo.live/r/example?p=evil&next=https://evil.example"), (e) => { events.push(e); });
    expect(new URL(res.headers.get("location")!).host).toBe("appdemo.live");
    expect(events[0].placement).toBe("other");
  });
  it("route handler works with the default logger", async () => {
    const res = await GET(req());
    expect(res.status).toBe(303);
  });
});
