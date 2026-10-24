import campaign from "@/content/example-campaign.json";
import samples from "@/content/demo-samples.json";
import { EXAMPLE_STAGES } from "@/lib/example-stages";
import { StageNavigator, type StagePanel } from "@/components/stage-navigator";

/*
 * Public example campaign (PRD v1.4 R1).
 * ASSUMPTION A1: the example app is the fictional InvoicePilot sample.
 * ASSUMPTION A2: media under /public/example are rendered illustrations, labeled "Illustrative example".
 * ASSUMPTION A3: every number in Measure is labeled "Example data".
 * ASSUMPTION A4: the 14-day plan and two revision rounds describe product behavior, not package terms.
 */
const sample = samples.samples.find((s) => s.id === campaign.sampleId)!;
const clipById = new Map(campaign.clips.map((c) => [c.id, c]));
const link = "/r/example?p=promote";

export function IllustrativeBadge({ children = "Illustrative example" }: { children?: string }) {
  return <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{children}</span>;
}

export function ExampleVideo({ src, label, vertical = false }: { src: string; label: string; vertical?: boolean }) {
  return (
    <video
      controls
      muted
      playsInline
      preload="none"
      poster={vertical ? undefined : "/example/poster.jpg"}
      aria-label={label}
      className={`w-full rounded-lg bg-slate-900 ${vertical ? "aspect-[9/16]" : "aspect-video"}`}
    >
      <source src={`/example/${src}.mp4`} type="video/mp4" />
      <track kind="captions" src={`/example/${src}.vtt`} srcLang="en" label="English" default />
      Your browser can&apos;t play this video. <a href={`/example/${src}.mp4`}>Download it</a>.
    </video>
  );
}

function List({ items }: { items: string[] }) {
  return <ul className="space-y-1">{items.map((x) => <li key={x}>• {x}</li>)}</ul>;
}

function panels(): StagePanel[] {
  const b = sample.brief;
  const a = sample.analysis;
  const transcript = campaign.source.scenes.map((s) => s.caption);
  const r = campaign.results;
  const featured = ["hook", "demo", "objection", "cta"];
  const content: Record<string, Omit<StagePanel, "id" | "label" | "owner">> = {
    understand: {
      input: (
        <dl className="space-y-2">
          <div><dt className="font-semibold">What it does</dt><dd>{b.founderDescription}</dd></div>
          <div><dt className="font-semibold">Who it&apos;s for</dt><dd>{b.targetCustomer}</dd></div>
          <div><dt className="font-semibold">Offer</dt><dd>{b.pricingSummary}</dd></div>
          <div><dt className="font-semibold">Primary action</dt><dd>{b.primaryCta}</dd></div>
        </dl>
      ),
      output: (
        <div className="space-y-4">
          <p className="font-semibold">Product truth sheet <span className="font-normal text-slate-500">(founder-approved brief)</span></p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><p className="font-semibold">Problem</p><p>{a.primaryProblem}</p></div>
            <div><p className="font-semibold">Promise</p><p>{a.primaryOutcome}</p></div>
            <div><p className="font-semibold">Differentiators</p><List items={a.differentiators} /></div>
            <div><p className="font-semibold">Claims that need proof before use</p><List items={a.claimsRequiringVerification} /></div>
          </div>
        </div>
      ),
      why: "Every video and post is written from facts you approved, so nothing promises a feature, price or trial you don't offer.",
    },
    demonstrate: {
      input: (
        <div className="space-y-2">
          <p>A run-of-show and rehearsal checklist, then the founder records the demo (or uploads one).</p>
          <ol className="list-decimal space-y-1 pl-5">{sample.runbook.demoPlan.map((d) => <li key={d.step}>{d.step} ({d.minutes} min)</li>)}</ol>
        </div>
      ),
      output: (
        <div className="space-y-3">
          <div className="flex items-center gap-2"><p className="font-semibold">{campaign.source.title}</p><IllustrativeBadge /></div>
          <ExampleVideo src="source-demo" label="InvoicePilot source demo, illustrative example, with captions" />
          <details className="rounded-lg border border-slate-200 p-3">
            <summary className="cursor-pointer font-semibold">Transcript</summary>
            <ol className="mt-2 space-y-1">{transcript.map((t) => <li key={t}>{t}</li>)}</ol>
          </details>
        </div>
      ),
      why: "One honest recording of your app working becomes the source for every clip, so you only have to show it once.",
    },
    create: {
      input: <p>The approved source demo, the truth sheet and the primary action. The founder reviews each clip and can approve, ask for a revision (two rounds included as product behavior) or reject. Any edit needs re-approval.</p>,
      output: (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">Launch Content Pack: {campaign.clips.length} clips</p><IllustrativeBadge /></div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {featured.map((id) => {
              const c = clipById.get(id)!;
              return (
                <figure key={id} className="min-w-0">
                  <ExampleVideo src={`clip-${id}`} label={`${c.kind} clip, illustrative example`} vertical />
                  <figcaption className="mt-1 text-xs"><span className="font-semibold">{c.kind}</span> · {c.durationSeconds}s</figcaption>
                </figure>
              );
            })}
          </div>
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-slate-200"><th className="py-1 pr-2">Clip</th><th className="py-1 pr-2">Its job</th><th className="py-1">Status</th></tr></thead>
            <tbody>
              {campaign.clips.map((c) => (
                <tr key={c.id} className="border-b border-slate-100">
                  <td className="py-1 pr-2 font-semibold"><a className="text-indigo-700 underline" href={`/example/clip-${c.id}.mp4`}>{c.kind}</a></td>
                  <td className="py-1 pr-2">{c.job}</td>
                  <td className="py-1">Approved (example)</td>
                </tr>
              ))}
            </tbody>
          </table>
          <a href="/example/invoicepilot-example-pack.zip" download className="inline-block rounded-md border border-slate-300 px-4 py-2 font-semibold text-slate-800 hover:bg-slate-50">Download the example pack (.zip)</a>
        </div>
      ),
      why: "Each clip has one job, from stopping the scroll to answering the doubt that stops people buying, so you're never posting the same video eight times.",
    },
    promote: {
      input: <p>Approved clips, ready-to-paste post copy and one tracked link. The founder posts from their own accounts; AppDemo never asks for social passwords and never marks a post published unless it was.</p>,
      output: (
        <div className="space-y-4">
          <div className="space-y-2">
            {campaign.posts.map((p) => (
              <div key={p.clip + p.channel} className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold text-slate-500">{p.channel} · {clipById.get(p.clip)?.kind} clip</p>
                <p className="mt-1">{p.copy.replace("{link}", "appdemo.live/r/example")}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="font-semibold">14-day posting plan</p>
            <ol className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {campaign.plan.map((d) => (
                <li key={d.day} className="flex gap-2 rounded bg-slate-50 px-2 py-1 text-xs">
                  <span className="w-12 shrink-0 font-semibold">Day {d.day}</span>
                  <span>{d.action === "Post" ? `Post the ${clipById.get(d.clip!)?.kind} clip on ${d.channel}` : `${d.action}: ${d.note}`}</span>
                </li>
              ))}
            </ol>
          </div>
          <a href={link} className="inline-block rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700">Try the tracked link: {campaign.primaryAction}</a>
          <p className="text-xs text-slate-500">This example link logs a click and brings you back here. It never counts as a signup or sale.</p>
        </div>
      ),
      why: "A plan you can follow in minutes a day, with every post carrying a link that tells you which clip and channel actually brought people in.",
    },
    measure: {
      input: <p>One primary goal ({campaign.primaryAction.toLowerCase()}), tracked links per post, and only sources we can observe. Duplicate clicks count once; a disconnected source shows as unavailable, not zero.</p>,
      output: (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">Results: {r.period}</p><IllustrativeBadge>{r.label}</IllustrativeBadge></div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Example data, not measured results</caption>
              <thead><tr className="border-b border-slate-200"><th className="py-1 pr-2">Clip</th><th className="py-1 pr-2">Channel</th><th className="py-1 pr-2">Unique clicks</th><th className="py-1">Schedules created</th></tr></thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr key={x.clip + x.channel} className="border-b border-slate-100">
                    <td className="py-1 pr-2">{clipById.get(x.clip)?.kind}</td><td className="py-1 pr-2">{x.channel}</td><td className="py-1 pr-2">{x.clicks} <span className="text-amber-700">(example)</span></td><td className="py-1">{x.actions} <span className="text-amber-700">(example)</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs">Unavailable: {r.unavailable.join(", ")}.</p>
          <p className="text-xs text-slate-500">Source: {r.source}</p>
        </div>
      ),
      why: "You see which message and channel moved people to act, not just views, with clear limits on what the numbers can tell you.",
    },
    improve: {
      input: <p>The measured results and their limits.</p>,
      output: (
        <div className="space-y-2">
          <p className="font-semibold">One proposed next experiment</p>
          <dl className="space-y-2">
            <div><dt className="font-semibold">Hypothesis</dt><dd>{campaign.experiment.hypothesis}</dd></div>
            <div><dt className="font-semibold">Change</dt><dd>{campaign.experiment.change}</dd></div>
            <div><dt className="font-semibold">Measure</dt><dd>{campaign.experiment.metric}</dd></div>
            <div><dt className="font-semibold">Decide only after</dt><dd>{campaign.experiment.minimumSample}</dd></div>
            <div><dt className="font-semibold">Why this one</dt><dd>{campaign.experiment.why}</dd></div>
          </dl>
        </div>
      ),
      why: "Instead of guessing, your next round tests one change, and we won't name a winner until there's enough evidence.",
    },
  };
  return EXAMPLE_STAGES.map((s) => ({ ...s, ...content[s.id] }));
}

export function ExampleCampaign() {
  return <StageNavigator stages={panels()} />;
}
