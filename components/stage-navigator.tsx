"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { tabKeyTarget } from "@/lib/tabs";
import { stageIndexFromHash } from "@/lib/example-stages";

export interface StagePanel {
  id: string;
  label: string;
  owner: string;
  input: ReactNode;
  output: ReactNode;
  why: ReactNode;
}

/**
 * Accessible six-stage navigator (WAI-ARIA tabs, automatic activation). The selected stage is kept
 * in the URL hash, so returning to the page or a stage restores the visitor's place. Switching stages
 * is purely client-side: it never charges, publishes or starts a generation job.
 */
export function StageNavigator({ stages }: { stages: StagePanel[] }) {
  const [active, setActive] = useState(0);
  const [clicked, setClicked] = useState(false);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const sync = () => {
      const i = stageIndexFromHash(window.location.hash);
      if (i !== null) setActive(i);
    };
    sync();
    setClicked(new URLSearchParams(window.location.search).get("example_click") === "1");
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  function select(i: number, focus = false) {
    setActive(i);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#stage-${stages[i].id}`);
    if (focus) tabs.current[i]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const next = tabKeyTarget(i, e.key, stages.length);
    if (next === null) return;
    e.preventDefault();
    select(next, true);
  }

  return (
    <div>
      {clicked && (
        <div role="status" className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Your click on the example link was tracked. It counts as an example click, not a sale or signup.
        </div>
      )}
      <div role="tablist" aria-label="Example campaign stages" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {stages.map((s, i) => {
          const selected = i === active;
          return (
            <button
              key={s.id}
              ref={(el) => { tabs.current[i] = el; }}
              id={`tab-${s.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`panel-${s.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`rounded-lg border px-3 py-3 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 ${selected ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-800 hover:border-indigo-300"}`}
            >
              <span className={`block text-xs font-semibold ${selected ? "text-indigo-100" : "text-indigo-600"}`}>Step {i + 1}</span>
              <span className="block font-semibold">{s.label}</span>
            </button>
          );
        })}
      </div>
      {stages.map((s, i) => (
        <div
          key={s.id}
          id={`panel-${s.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${s.id}`}
          tabIndex={0}
          hidden={i !== active}
          className="mt-6 rounded-xl border border-slate-200 bg-white p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 sm:p-6"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xl font-bold">Step {i + 1}: {s.label}</h3>
            <span className="text-xs text-slate-500">Who acts: {s.owner}</span>
          </div>
          <div className="mt-5 grid gap-6 lg:grid-cols-3">
            <section className="min-w-0">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Input</h4>
              <div className="mt-2 text-sm text-slate-700">{s.input}</div>
            </section>
            <section className="min-w-0 lg:col-span-2">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Output</h4>
              <div className="mt-2 text-sm text-slate-700">{s.output}</div>
            </section>
          </div>
          <p className="mt-6 rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-900"><span className="font-semibold">Why it helps: </span>{s.why}</p>
          <div className="mt-4 flex justify-between text-sm">
            <button type="button" disabled={i === 0} onClick={() => select(i - 1)} className="font-medium text-indigo-700 disabled:invisible">← {stages[i - 1]?.label}</button>
            <button type="button" disabled={i === stages.length - 1} onClick={() => select(i + 1)} className="font-medium text-indigo-700 disabled:invisible">{stages[i + 1]?.label} →</button>
          </div>
        </div>
      ))}
    </div>
  );
}
