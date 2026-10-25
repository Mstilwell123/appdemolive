import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createBlobStorageAdapter } from "@/integrations/storage/blob";
import { getStorage, setStorageForTests } from "@/integrations/storage";

function fakeDeps() {
  const calls: Record<string, unknown[]> = { issue: [], presign: [], del: [] };
  const deps = {
    issueSignedToken: vi.fn(async (o: unknown) => { calls.issue.push(o); return { delegationToken: "d", clientSigningToken: "c", validUntil: 0 }; }),
    presignUrl: vi.fn(async (_t: unknown, o: { operation: string; pathname: string }) => { calls.presign.push(o); return { presignedUrl: `https://blob.test/${o.operation}/${o.pathname}?sig=x` }; }),
    head: vi.fn(async (p: string) => { if (p === "org/l/missing.mp4") throw new Error("not found"); return { size: 42, contentType: "video/mp4" }; }),
    get: vi.fn(async () => ({ statusCode: 200, stream: new Response("data").body })),
    del: vi.fn(async (p: string) => { calls.del.push(p); }),
  };
  return { deps: deps as never, calls };
}

describe("vercel blob storage adapter", () => {
  it("mints a private presigned PUT scoped to one path, type and size", async () => {
    const { deps, calls } = fakeDeps();
    const a = createBlobStorageAdapter(deps);
    const t = await a.createUploadTarget("org/l/file.mp4", "video/mp4", 1000);
    expect(t.method).toBe("PUT");
    expect(t.url).toContain("https://blob.test/put/org/l/file.mp4");
    expect(t.headers["content-type"]).toBe("video/mp4");
    expect(calls.issue[0]).toMatchObject({ pathname: "org/l/file.mp4", operations: ["put"], allowedContentTypes: ["video/mp4"], maximumSizeInBytes: 1000 });
    expect(calls.presign[0]).toMatchObject({ access: "private", addRandomSuffix: false, maximumSizeInBytes: 1000 });
  });
  it("refuses unsafe keys, missing types and bad sizes", async () => {
    const a = createBlobStorageAdapter(fakeDeps().deps);
    await expect(a.createUploadTarget("../etc/passwd", "video/mp4", 10)).rejects.toThrow();
    await expect(a.createUploadTarget("/abs/x.mp4", "video/mp4", 10)).rejects.toThrow();
    await expect(a.createUploadTarget("org/l/x.mp4", "", 10)).rejects.toThrow();
    await expect(a.createUploadTarget("org/l/x.mp4", "video/mp4", 0)).rejects.toThrow();
    await expect(a.downloadUrl("a/../b")).rejects.toThrow();
  });
  it("reports size and type of stored objects, null when missing", async () => {
    const a = createBlobStorageAdapter(fakeDeps().deps);
    expect(await a.exists("org/l/file.mp4")).toEqual({ size: 42, contentType: "video/mp4" });
    expect(await a.exists("org/l/missing.mp4")).toBeNull();
    expect(await a.exists("../x")).toBeNull();
  });
  it("reads, signs short-lived private downloads and removes", async () => {
    const { deps, calls } = fakeDeps();
    const a = createBlobStorageAdapter(deps);
    expect(await (await a.read("org/l/file.mp4"))!.text()).toBe("data");
    const url = await a.downloadUrl("org/l/file.mp4", 60);
    expect(url).toContain("/get/org/l/file.mp4");
    expect(calls.issue[0]).toMatchObject({ operations: ["get"] });
    expect(calls.presign[0]).toMatchObject({ access: "private" });
    await a.remove("org/l/file.mp4");
    expect(calls.del).toEqual(["org/l/file.mp4"]);
  });
});

describe("storage driver selection", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; setStorageForTests(undefined); });
  it("uses blob only when STORAGE_DRIVER=blob and a token is present", () => {
    setStorageForTests(undefined);
    process.env.STORAGE_DRIVER = "blob";
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(getStorage()).toBeNull();
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token";
    expect(getStorage()?.name).toBe("blob");
    process.env.STORAGE_DRIVER = "local";
    expect(getStorage()?.name).toBe("local");
  });
});
