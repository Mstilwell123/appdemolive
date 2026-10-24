import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
const dir = mkdtempSync(join(tmpdir(), "appdemo-storage-"));
beforeAll(() => { process.env.LOCAL_STORAGE_DIR = dir; });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const req = (url: string, init?: RequestInit) => new NextRequest(new URL(url, "http://localhost"), init as never);

describe("local storage adapter", () => {
  it("rejects unsafe keys", async () => {
    const { safeKey } = await import("@/integrations/storage");
    for (const k of ["../x", "/etc/passwd", "a//b", "a/../b", "a\\b", "", "a/b c"]) expect(safeKey(k)).toBeNull();
    expect(safeKey("org/launch/file-1.mp4")).toBe("org/launch/file-1.mp4");
  });

  it("uploads with a signed URL, verifies existence, downloads, and refuses tampering", async () => {
    const { localStorageAdapter: s, verify } = await import("@/integrations/storage");
    const route = await import("@/app/api/storage/route");
    const target = await s.createUploadTarget("o1/l1/a.webm", "video/webm", 10);
    const tampered = target.url.replace("o1%2Fl1", "o2%2Fl1");
    expect((await route.PUT(req(tampered, { method: "PUT", body: "hello", duplex: "half" } as never))).status).toBe(403);
    expect((await route.PUT(req(target.url, { method: "PUT", body: "this is too long", duplex: "half" } as never))).status).toBe(413);
    expect(await s.exists("o1/l1/a.webm")).toBeNull();
    expect((await route.PUT(req(target.url, { method: "PUT", body: "hello", duplex: "half" } as never))).status).toBe(200);
    expect(await s.exists("o1/l1/a.webm")).toEqual({ size: 5 });
    expect(await (await s.read("o1/l1/a.webm"))?.text()).toBe("hello");
    const dl = await s.downloadUrl("o1/l1/a.webm");
    expect((await route.GET(req(dl.replace("op=get", "op=put")))).status).toBe(403);
    const ok = await route.GET(req(dl));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("hello");
    expect(verify("get", "o1/l1/a.webm", Math.floor(Date.now() / 1000) - 1, "x")).toBe(false);
  });
});
