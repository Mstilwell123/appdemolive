import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

/**
 * File storage behind one small interface, so the app never depends on a specific provider.
 * Only the local adapter exists today. ASSUMPTION: no paid storage is adopted; when the app runs in
 * production without STORAGE_DRIVER=local, getStorage() returns null and callers report
 * PROVIDER_UNAVAILABLE instead of pretending a file was saved.
 */
export interface UploadTarget { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string }
export interface StorageAdapter {
  readonly name: string;
  createUploadTarget(path: string, contentType: string, maxBytes: number): Promise<UploadTarget>;
  exists(path: string): Promise<{ size: number } | null>;
  read(path: string): Promise<Blob | null>;
  downloadUrl(path: string, ttlSeconds?: number): Promise<string>;
  remove(path: string): Promise<void>;
}

const UPLOAD_TTL_S = 60 * 60;
const DOWNLOAD_TTL_S = 15 * 60;
/** ASSUMPTION: the dev-only signing key is used only outside production when BETTER_AUTH_SECRET is unset. */
const DEV_SECRET = "appdemo-local-storage-dev-only";

export function storageRoot() {
  return resolve(process.env.LOCAL_STORAGE_DIR || ".data/uploads");
}
function secret() {
  const s = process.env.BETTER_AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("BETTER_AUTH_SECRET is required to sign storage URLs");
  return DEV_SECRET;
}

/** Object keys are org/launch/file style: no absolute paths, no "..", no backslashes. */
export function safeKey(path: string): string | null {
  if (!path || path.length > 500 || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return null;
  const parts = path.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || !/^[A-Za-z0-9._-]+$/.test(p))) return null;
  return path;
}
function fileFor(key: string) {
  const root = storageRoot();
  const full = resolve(root, key);
  if (!full.startsWith(root + sep)) throw new Error("Path escapes storage root");
  return full;
}

export type StorageOp = "put" | "get";
export function sign(op: StorageOp, key: string, exp: number, extra = "") {
  return createHmac("sha256", secret()).update(`${op}\n${key}\n${exp}\n${extra}`).digest("base64url");
}
export function verify(op: StorageOp, key: string, exp: number, sig: string, extra = "", now = Date.now()) {
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const want = Buffer.from(sign(op, key, exp, extra));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
function signedUrl(op: StorageOp, key: string, ttl: number, extra?: Record<string, string>) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const extraStr = extra ? Object.entries(extra).map(([k, v]) => `${k}=${v}`).join("&") : "";
  const q = new URLSearchParams({ op, key, exp: String(exp), ...(extra ?? {}), sig: sign(op, key, exp, extraStr) });
  return { url: `/api/storage?${q.toString()}`, exp };
}

/** Writes a request body to disk atomically (temp file, then rename), refusing anything over maxBytes. */
export async function writeStream(key: string, body: WebReadableStream<Uint8Array>, maxBytes: number) {
  const full = fileFor(key);
  await mkdir(dirname(full), { recursive: true });
  const tmp = `${full}.part-${process.pid}-${Date.now()}`;
  let seen = 0;
  const source = Readable.fromWeb(body);
  source.on("data", (c: Buffer) => { seen += c.length; if (seen > maxBytes) source.destroy(new Error("TOO_LARGE")); });
  try {
    await pipeline(source, createWriteStream(tmp));
    if (seen === 0) throw new Error("EMPTY");
    await rename(tmp, full);
    return seen;
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}
export function readStream(key: string) {
  return Readable.toWeb(createReadStream(fileFor(key))) as unknown as ReadableStream<Uint8Array>;
}

export const localStorageAdapter: StorageAdapter = {
  name: "local",
  async createUploadTarget(path, contentType, maxBytes) {
    const key = safeKey(path);
    if (!key) throw new Error("Invalid storage key");
    const { url, exp } = signedUrl("put", key, UPLOAD_TTL_S, { max: String(maxBytes) });
    return { url, method: "PUT", headers: { "content-type": contentType || "application/octet-stream" }, expiresAt: new Date(exp * 1000).toISOString() };
  },
  async exists(path) {
    const key = safeKey(path);
    if (!key) return null;
    try { const s = await stat(fileFor(key)); return s.isFile() && s.size > 0 ? { size: s.size } : null; } catch { return null; }
  },
  async read(path) {
    const key = safeKey(path);
    if (!key || !(await this.exists(key))) return null;
    return new Response(readStream(key)).blob();
  },
  async downloadUrl(path, ttl = DOWNLOAD_TTL_S) {
    const key = safeKey(path);
    if (!key) throw new Error("Invalid storage key");
    return signedUrl("get", key, ttl).url;
  },
  async remove(path) {
    const key = safeKey(path);
    if (key) await rm(fileFor(key), { force: true });
  },
};

let override: StorageAdapter | null | undefined;
/** Tests swap the adapter (or null to simulate "no storage configured"). */
export function setStorageForTests(a: StorageAdapter | null | undefined) { override = a; }

export function getStorage(): StorageAdapter | null {
  if (override !== undefined) return override;
  const driver = process.env.STORAGE_DRIVER;
  if (driver === "local") return localStorageAdapter;
  if (!driver && process.env.NODE_ENV !== "production") return localStorageAdapter;
  return null;
}
