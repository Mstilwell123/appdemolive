/** PRD v1.4 R7: tracked links. Pure helpers shared by the redirect route and the Measure page. */
export const CLICK_WINDOW_MS = 30 * 60 * 1000;
export const clickWindow = (at: Date) => Math.floor(at.getTime() / CLICK_WINDOW_MS);
export const VISITOR_COOKIE = "ad_v";
export const SLUG_RE = /^[A-Za-z0-9_-]{8,32}$/;

/** Sources the Measure page reports. Only tracked-link clicks are connected in this build. */
export const SOURCES = [
  { id: "clicks", label: "Tracked link clicks" },
  { id: "signups", label: "Signups on your site" },
  { id: "platform", label: "Platform views and engagement" },
] as const;
export type SourceId = (typeof SOURCES)[number]["id"];

/** A disconnected source is "unavailable", never zero: we don't know the number. */
export type Metric = { source: SourceId; label: string; status: "connected"; value: number } | { source: SourceId; label: string; status: "unavailable"; value: null };
export function metricsFor(connected: Partial<Record<SourceId, number>>): Metric[] {
  return SOURCES.map((s) => (connected[s.id] === undefined
    ? { source: s.id, label: s.label, status: "unavailable" as const, value: null }
    : { source: s.id, label: s.label, status: "connected" as const, value: connected[s.id]! }));
}
export const metricText = (m: Metric) => (m.status === "connected" ? String(m.value) : "Unavailable (not connected)");
