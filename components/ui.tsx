import Link from "next/link";
import { stageInfo } from "@/domain/launch-stages";
import type { LaunchStatus } from "@/types/launch";

export function Panel({ title, children, id, highlight = false }: { title: string; children: React.ReactNode; id?: string; highlight?: boolean }) {
  return (
    <section id={id} className={`scroll-mt-6 rounded-xl border bg-white p-6 ${highlight ? "border-indigo-300 ring-1 ring-indigo-100" : "border-slate-200"}`}>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ErrorBanner({ message }: { message?: string | string[] }) {
  const m = Array.isArray(message) ? message[0] : message;
  if (!m) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
      {m}
    </div>
  );
}

export function LoadError({ what }: { what: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-900">
      <h2 className="font-semibold">We couldn&apos;t load {what}</h2>
      <p className="mt-1 text-sm">Please refresh. If it keeps happening, contact support@pragvance.ai.</p>
    </div>
  );
}

export function Empty({ title, body, href, cta }: { title: string; body: string; href?: string; cta?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{body}</p>
      {href && cta && (
        <Link href={href} className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
          {cta}
        </Link>
      )}
    </div>
  );
}

export function LaunchStatusBadge({ status }: { status: string }) {
  const info = stageInfo(status as LaunchStatus);
  const tone =
    status === "CANCELLED" || status === "FAILED" ? "bg-slate-200 text-slate-700" : status === "CHANGES_REQUIRED" ? "bg-amber-100 text-amber-900" : "bg-indigo-100 text-indigo-800";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{info.label}</span>;
}

const Q_TONE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  in_review: "bg-sky-100 text-sky-800",
  qualified: "bg-emerald-100 text-emerald-800",
  changes_required: "bg-amber-100 text-amber-900",
  rejected: "bg-red-100 text-red-800",
  pass: "bg-emerald-100 text-emerald-800",
  fail: "bg-red-100 text-red-800",
  n_a: "bg-slate-100 text-slate-600",
};
const Q_LABEL: Record<string, string> = {
  pending: "Waiting for review",
  in_review: "In review",
  qualified: "Qualified",
  changes_required: "Changes needed",
  rejected: "Not approved",
  pass: "Pass",
  fail: "Fail",
  n_a: "Not applicable",
};
export function QualBadge({ status }: { status: string }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${Q_TONE[status] ?? "bg-slate-100"}`}>{Q_LABEL[status] ?? status}</span>;
}

export const inputClass = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-slate-50";
export const buttonClass = "rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50";
export const secondaryButtonClass = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50";

export function TextField(props: { label: string; name: string; defaultValue?: string | null; required?: boolean; type?: string; help?: string; disabled?: boolean; placeholder?: string; maxLength?: number }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-800">
        {props.label}
        {props.required && <span className="text-red-600"> *</span>}
      </span>
      <input
        name={props.name}
        type={props.type ?? "text"}
        defaultValue={props.defaultValue ?? ""}
        disabled={props.disabled}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        className={inputClass}
      />
      {props.help && <span className="mt-1 block text-xs text-slate-500">{props.help}</span>}
    </label>
  );
}

export function TextArea(props: { label: string; name: string; defaultValue?: string | null; required?: boolean; help?: string; disabled?: boolean; rows?: number; maxLength?: number }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-800">
        {props.label}
        {props.required && <span className="text-red-600"> *</span>}
      </span>
      <textarea name={props.name} rows={props.rows ?? 3} defaultValue={props.defaultValue ?? ""} disabled={props.disabled} maxLength={props.maxLength} className={inputClass} />
      {props.help && <span className="mt-1 block text-xs text-slate-500">{props.help}</span>}
    </label>
  );
}

export function money(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency ?? "usd").toUpperCase(), maximumFractionDigits: 0 }).format(amount / 100);
}

export function when(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" }) + " PT";
}
