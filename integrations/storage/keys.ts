/** Object keys are org/launch/file style: no absolute paths, no "..", no backslashes. */
export function safeKey(path: string): string | null {
  if (!path || path.length > 500 || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return null;
  const parts = path.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || !/^[A-Za-z0-9._-]+$/.test(p))) return null;
  return path;
}
