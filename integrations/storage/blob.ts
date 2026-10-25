import "server-only";
import { del, get, head, issueSignedToken, presignUrl } from "@vercel/blob";
import type { StorageAdapter } from "./index";
import { safeKey } from "./keys";

/**
 * Vercel Blob adapter (private store). The browser never gets the store token: the server mints a
 * presigned PUT scoped to one pathname, one content type and a byte ceiling, and presigned GETs
 * that expire. Callers run ownership checks before asking for either.
 */
const UPLOAD_TTL_MS = 60 * 60 * 1000;
const DOWNLOAD_TTL_S = 15 * 60;

function key(path: string) {
  const k = safeKey(path);
  if (!k) throw new Error("Invalid storage key");
  return k;
}

export function createBlobStorageAdapter(deps = { del, get, head, issueSignedToken, presignUrl }): StorageAdapter {
  return {
    name: "blob",
    async createUploadTarget(path, contentType, maxBytes) {
      const pathname = key(path);
      if (!contentType) throw new Error("Content type is required");
      if (!(maxBytes > 0)) throw new Error("Invalid size limit");
      const validUntil = Date.now() + UPLOAD_TTL_MS;
      const opts = { pathname, allowedContentTypes: [contentType], maximumSizeInBytes: maxBytes, validUntil };
      const token = await deps.issueSignedToken({ ...opts, operations: ["put"] });
      const { presignedUrl } = await deps.presignUrl(token, {
        ...opts, operation: "put", access: "private", addRandomSuffix: false, allowOverwrite: true,
      });
      return { url: presignedUrl, method: "PUT", headers: { "content-type": contentType }, expiresAt: new Date(validUntil).toISOString() };
    },
    async exists(path) {
      const pathname = safeKey(path);
      if (!pathname) return null;
      try {
        const h = await deps.head(pathname);
        return h.size > 0 ? { size: h.size, contentType: h.contentType } : null;
      } catch {
        return null;
      }
    },
    async read(path) {
      const pathname = safeKey(path);
      if (!pathname) return null;
      const r = await deps.get(pathname, { access: "private", useCache: false }).catch(() => null);
      if (!r || r.statusCode !== 200 || !r.stream) return null;
      return new Response(r.stream).blob();
    },
    async downloadUrl(path, ttl = DOWNLOAD_TTL_S) {
      const pathname = key(path);
      const validUntil = Date.now() + ttl * 1000;
      const token = await deps.issueSignedToken({ pathname, operations: ["get"], validUntil });
      const { presignedUrl } = await deps.presignUrl(token, { operation: "get", pathname, access: "private", validUntil });
      return presignedUrl;
    },
    async remove(path) {
      const pathname = safeKey(path);
      if (pathname) await deps.del(pathname).catch(() => undefined);
    },
  };
}
