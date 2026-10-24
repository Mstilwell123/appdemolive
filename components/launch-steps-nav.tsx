import Link from "next/link";

/** PRD v1.4 §116: the six founder steps, each with its own working page. */
export const LAUNCH_STEPS = [
  { slug: "understand", label: "Understand" },
  { slug: "demonstrate", label: "Demonstrate" },
  { slug: "create", label: "Create" },
  { slug: "promote", label: "Promote" },
  { slug: "measure", label: "Measure" },
  { slug: "improve", label: "Improve" },
] as const;
export type LaunchStepSlug = (typeof LAUNCH_STEPS)[number]["slug"];

export function LaunchStepsNav({ launchId, current, available }: { launchId: string; current?: LaunchStepSlug; available: readonly LaunchStepSlug[] }) {
  return (
    <nav aria-label="Launch steps" className="overflow-x-auto">
      <ol className="flex min-w-max gap-2 text-sm">
        <li><Link href={`/dashboard/launches/${launchId}`} className="inline-block rounded-md border border-slate-200 px-3 py-1.5 text-slate-700 hover:bg-slate-50">Overview</Link></li>
        {LAUNCH_STEPS.filter((s) => available.includes(s.slug)).map((s) => {
          const n = LAUNCH_STEPS.findIndex((x) => x.slug === s.slug) + 1;
          const active = s.slug === current;
          return (
            <li key={s.slug}>
              <Link href={`/dashboard/launches/${launchId}/${s.slug}`} aria-current={active ? "page" : undefined}
                className={`inline-block rounded-md border px-3 py-1.5 ${active ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                {n}. {s.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
