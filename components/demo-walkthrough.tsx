"use client";

import { useEffect, useRef, useState } from "react";
import data from "@/content/demo-samples.json";

type Sample = (typeof data.samples)[number];

const stages = [
  "Reading the product brief",
  "Analyzing the product and its customers",
  "Writing the launch strategy",
  "Drafting the questions customers will ask",
  "Building the run-of-show",
];
const STAGE_MS = 900;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
}

/** Landing-page Demo: replays real, saved output of the launch-preparation AI pipeline for fictional sample products. */
export function DemoWalkthrough() {
  const [selected, setSelected] = useState<string>(data.samples[0].id);
  // -1 = not started, 0..stages.length-1 = running, stages.length = finished
  const [stage, setStage] = useState(-1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sample = data.samples.find((s) => s.id === selected) ?? data.samples[0];

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  function pick(id: string) {
    if (timer.current) clearInterval(timer.current);
    setSelected(id);
    setStage(-1);
  }

  function run() {
    if (timer.current) clearInterval(timer.current);
    const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) { setStage(stages.length); return; }
    setStage(0);
    timer.current = setInterval(() => {
      setStage((s) => {
        if (s + 1 >= stages.length) { if (timer.current) clearInterval(timer.current); return stages.length; }
        return s + 1;
      });
    }, STAGE_MS);
  }

  const running = stage >= 0 && stage < stages.length;
  const done = stage >= stages.length;

  return (
    <div className="mt-12">
      <div role="tablist" aria-label="Sample products" className="grid gap-4 md:grid-cols-3">
        {data.samples.map((s) => {
          const active = s.id === selected;
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={active}
              onClick={() => pick(s.id)}
              className={`rounded-lg border p-5 text-left transition ${active ? "border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600" : "border-slate-200 hover:border-indigo-300"}`}
            >
              <span className="text-sm font-semibold text-indigo-600">{s.launchType === "cohosted_launch" ? "Co-Hosted Launch Show" : "Founder Demo"}</span>
              <h3 className="mt-2 font-semibold">{s.brief.appName}</h3>
              <p className="mt-2 text-sm text-slate-600">{s.brief.targetCustomer}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Brief sample={sample} />
        <div className="rounded-xl border border-slate-200 p-6 lg:col-span-2">
          {stage === -1 && (
            <div className="flex h-full min-h-64 flex-col items-center justify-center text-center">
              <p className="max-w-md text-slate-600">
                See what our AI prepares for {sample.brief.appName} from the brief on the left.
              </p>
              <button onClick={run} className="mt-6 rounded-md bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700">
                Run the demo
              </button>
            </div>
          )}
          {running && (
            <ol className="flex min-h-64 flex-col justify-center gap-3" aria-live="polite">
              {stages.map((label, i) => (
                <li key={label} className={`flex items-center gap-3 text-sm transition-opacity ${i > stage ? "opacity-40" : "opacity-100"}`}>
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i < stage ? "bg-indigo-600 text-white" : i === stage ? "border-2 border-indigo-600 text-indigo-600" : "border border-slate-300 text-slate-400"}`}>
                    {i < stage ? "✓" : i + 1}
                  </span>
                  <span className={i === stage ? "font-semibold" : ""}>{label}{i === stage ? "…" : ""}</span>
                </li>
              ))}
            </ol>
          )}
          {done && <Output sample={sample} onReplay={run} />}
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-slate-500">
        The sample products are fictional. The plans are real output from the same AI pipeline we use to prepare
        paid launches ({sample.provenance.model}, generated {formatDate(sample.provenance.generatedAt)}), not hand-edited, and replayed here so
        the demo is instant.
      </p>
    </div>
  );
}

function Brief({ sample }: { sample: Sample }) {
  const b = sample.brief;
  const rows: Array<[string, string | null | undefined]> = [
    ["What it does", b.founderDescription],
    ["Who it's for", b.targetCustomer],
    ["Problem", b.problemSolved],
    ["Pricing", b.pricingSummary],
    ["Call to action", b.primaryCta],
    ["Launch goal", sample.goal],
  ];
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-6">
      <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">Product brief</p>
      <h3 className="mt-2 text-xl font-semibold">{b.appName}</h3>
      <dl className="mt-4 space-y-3 text-sm">
        {rows.map(([k, v]) => v ? (
          <div key={k}>
            <dt className="font-semibold">{k}</dt>
            <dd className="mt-0.5 text-slate-600">{v}</dd>
          </div>
        ) : null)}
      </dl>
    </div>
  );
}

function Output({ sample, onReplay }: { sample: Sample; onReplay: () => void }) {
  const [tab, setTab] = useState<"strategy" | "questions" | "runbook">("strategy");
  const s = sample.strategy;
  const r = sample.runbook;
  const tabs = [
    { id: "strategy" as const, label: "Launch strategy" },
    { id: "questions" as const, label: `Customer questions (${sample.questions.length})` },
    { id: "runbook" as const, label: `Run-of-show (${r.durationMinutes} min)` },
  ];
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Generated plan" className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium ${tab === t.id ? "bg-indigo-600 text-white" : "border border-slate-200 text-slate-700 hover:border-indigo-300"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={onReplay} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">Replay</button>
      </div>

      {tab === "strategy" && (
        <div className="mt-6 space-y-5 text-sm">
          <Field label="Launch objective">{s.launchObjective}</Field>
          <Field label="Audience">{s.primaryAudience}</Field>
          <Field label="Opening hook"><span className="italic">&ldquo;{s.recommendedHook}&rdquo;</span></Field>
          <div className="grid gap-4 md:grid-cols-3">
            <Card label="Problem">{s.positioning.problem}</Card>
            <Card label="Promise">{s.positioning.promise}</Card>
            <Card label="Proof to show">{s.positioning.proof}</Card>
          </div>
          <Field label="Call to action">
            <span className="font-medium">{s.primaryCta.text}</span>
            <span className="block text-slate-500">{s.primaryCta.rationale}</span>
          </Field>
          <Field label="Risks to address">
            <ul className="mt-1 space-y-1">{s.risks.map((x) => <li key={x}>• {x}</li>)}</ul>
          </Field>
        </div>
      )}

      {tab === "questions" && (
        <ol className="mt-6 space-y-4 text-sm">
          {sample.questions.map((q, i) => (
            <li key={q.question} className="rounded-lg border border-slate-200 p-4">
              <p className="font-semibold"><span className="text-indigo-600">Q{i + 1}.</span> {q.question}</p>
              <p className="mt-1 text-slate-600">{q.whyItMatters}</p>
            </li>
          ))}
        </ol>
      )}

      {tab === "runbook" && (
        <div className="mt-6 text-sm">
          <p className="font-semibold">{r.title}</p>
          <p className="mt-1 italic text-slate-600">Open with: &ldquo;{r.openingHook}&rdquo;</p>
          <ol className="mt-4 space-y-3">
            {r.demoPlan.map((d, i) => (
              <li key={i} className="flex gap-4 rounded-lg border border-slate-200 p-4">
                <span className="w-14 shrink-0 font-semibold text-indigo-600">{d.minutes} min</span>
                <div>
                  <p className="font-semibold">{d.step}</p>
                  <p className="mt-1 text-slate-600">{d.script}</p>
                </div>
              </li>
            ))}
          </ol>
          <Field label="Call-to-action script" className="mt-4">{r.ctaScript}</Field>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="font-semibold">{label}</p>
      <div className="mt-0.5 text-slate-600">{children}</div>
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <p className="font-semibold">{label}</p>
      <p className="mt-1 text-slate-600">{children}</p>
    </div>
  );
}
