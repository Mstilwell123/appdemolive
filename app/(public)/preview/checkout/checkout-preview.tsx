"use client";
import { useEffect, useMemo, useState } from "react";
import { buttonClass, inputClass, money, secondaryButtonClass } from "@/components/ui";
import {
  FORMAT_DETAILS, MAX_GUESTS, formatInZone, orderSummary, participantsSchema, previewReference, validateSchedule,
  type Participants, type PreviewPrice,
} from "@/domain/checkout-preview";
import type { LaunchType } from "@/types/launch";

const STEPS = ["Format", "Schedule", "Participants", "Review and pay", "Confirmed"] as const;
const HOST_TZ = "America/Los_Angeles"; // ASSUMPTION A-CR1-1: AppDemo's team schedules in Pacific time.

function zones(): string[] {
  const s = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  return s ? s("timeZone") : [HOST_TZ, "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "UTC"];
}

export function CheckoutPreview({ prices, initialFormat, priceSource }: { prices: PreviewPrice[]; initialFormat: LaunchType; priceSource: "database" | "defaults" }) {
  const [step, setStep] = useState(0);
  const [format, setFormat] = useState<LaunchType>(initialFormat);
  const [timeZone, setTimeZone] = useState(HOST_TZ);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [people, setPeople] = useState<Participants>({ founderName: "", founderEmail: "", guests: [], moderatorNotes: "" });
  const [peopleErrors, setPeopleErrors] = useState<string[]>([]);
  const [agree, setAgree] = useState(false);
  const [paying, setPaying] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => { setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || HOST_TZ); }, []);
  const zoneList = useMemo(zones, []);
  const price = prices.find((p) => p.launchType === format) ?? prices[0];
  const summary = orderSummary(price);
  const details = FORMAT_DETAILS[price.launchType];

  function nextFromSchedule() {
    const r = validateSchedule({ date, time, timeZone });
    if ("error" in r) { setScheduleError(r.error); return; }
    setScheduleError(null); setScheduledAt(r.at); setStep(2);
  }
  function nextFromPeople() {
    const r = participantsSchema.safeParse(people);
    if (!r.success) { setPeopleErrors([...new Set(r.error.issues.map((i) => i.message))]); return; }
    setPeopleErrors([]); setPeople(r.data); setStep(3);
  }
  function pay() {
    if (paying || reference) return; // guards double submission
    setPaying(true);
    setTimeout(() => { setReference(previewReference(Date.now())); setPaying(false); setStep(4); }, 900);
  }
  const updateGuest = (i: number, k: "name" | "email", v: string) =>
    setPeople((p) => ({ ...p, guests: p.guests.map((g, j) => (j === i ? { ...g, [k]: v } : g)) }));

  const Summary = (
    <aside className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Order summary</h2>
      <div className="mt-3 flex justify-between"><span>{summary.lineLabel}</span><span>{money(summary.subtotal, summary.currency)}</span></div>
      <div className="mt-1 text-slate-500">{details.minutes}-minute live show</div>
      {scheduledAt && <div className="mt-3 text-slate-700">{formatInZone(scheduledAt, timeZone)}</div>}
      <div className="mt-4 flex justify-between border-t border-slate-200 pt-3 text-base font-semibold"><span>Total due today</span><span>{money(summary.total, summary.currency)}</span></div>
      <p className="mt-2 text-xs text-slate-500">{priceSource === "database" ? "Price from your saved launch prices." : "Default price (database not reachable)."} Taxes aren&apos;t calculated in the preview.</p>
    </aside>
  );

  return (
    <div>
      <h1 className="text-3xl font-bold">Book your launch</h1>
      <ol className="mt-4 flex flex-wrap gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className={`rounded-full px-3 py-1 ${i === step ? "bg-indigo-600 text-white" : i < step ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-500"}`}>{i + 1}. {s}</li>
        ))}
      </ol>

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_260px]">
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          {step === 0 && (
            <div className="space-y-3">
              {prices.map((p) => (
                <label key={p.launchType} className={`block cursor-pointer rounded-lg border p-4 ${format === p.launchType ? "border-indigo-500 ring-1 ring-indigo-200" : "border-slate-200"}`}>
                  <input type="radio" name="format" className="mr-2" checked={format === p.launchType} onChange={() => setFormat(p.launchType)} />
                  <span className="font-semibold">{p.label}</span> <span className="float-right font-semibold">{money(p.amount, p.currency)}</span>
                  <ul className="mt-2 list-disc pl-6 text-sm text-slate-600">{FORMAT_DETAILS[p.launchType].includes.map((x) => <li key={x}>{x}</li>)}</ul>
                </label>
              ))}
              <button className={buttonClass} onClick={() => setStep(1)}>Continue</button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <label className="block text-sm"><span className="font-medium">Your time zone</span>
                <select className={inputClass} value={timeZone} onChange={(e) => { setTimeZone(e.target.value); setScheduleError(null); }}>
                  {zoneList.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm"><span className="font-medium">Date</span>
                  <input type="date" className={inputClass} value={date} onChange={(e) => { setDate(e.target.value); setScheduleError(null); }} /></label>
                <label className="block text-sm"><span className="font-medium">Start time</span>
                  <input type="time" step={900} className={inputClass} value={time} onChange={(e) => { setTime(e.target.value); setScheduleError(null); }} /></label>
              </div>
              {(() => { const r = date && time ? validateSchedule({ date, time, timeZone }) : null; return r && "at" in r ? (
                <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                  <div>Your time: {formatInZone(r.at, timeZone)}</div>
                  <div>AppDemo team: {formatInZone(r.at, HOST_TZ)}</div>
                  <div className="text-slate-500">UTC: {r.at.toISOString().slice(0, 16).replace("T", " ")}</div>
                </div>) : null; })()}
              {scheduleError && <p role="alert" className="text-sm text-red-700">{scheduleError}</p>}
              <div className="flex gap-2"><button className={secondaryButtonClass} onClick={() => setStep(0)}>Back</button><button className={buttonClass} onClick={nextFromSchedule}>Continue</button></div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="font-medium">Your name</span><input className={inputClass} value={people.founderName} maxLength={120} onChange={(e) => setPeople({ ...people, founderName: e.target.value })} /></label>
                <label className="block"><span className="font-medium">Your email</span><input type="email" className={inputClass} value={people.founderEmail} onChange={(e) => setPeople({ ...people, founderEmail: e.target.value })} /></label>
              </div>
              <div>
                <p className="font-medium">Other presenters from your team <span className="font-normal text-slate-500">(optional, up to {MAX_GUESTS})</span></p>
                {people.guests.map((g, i) => (
                  <div key={i} className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                    <input aria-label="Guest name" placeholder="Name" className={inputClass} value={g.name} onChange={(e) => updateGuest(i, "name", e.target.value)} />
                    <input aria-label="Guest email" placeholder="Email" type="email" className={inputClass} value={g.email} onChange={(e) => updateGuest(i, "email", e.target.value)} />
                    <button className="mt-1 text-slate-500 hover:text-red-700" onClick={() => setPeople({ ...people, guests: people.guests.filter((_, j) => j !== i) })}>Remove</button>
                  </div>
                ))}
                {people.guests.length < MAX_GUESTS && <button className="mt-2 text-indigo-700 hover:underline" onClick={() => setPeople({ ...people, guests: [...people.guests, { name: "", email: "" }] })}>+ Add a presenter</button>}
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <p className="font-medium">Provided by AppDemo</p>
                <ul className="mt-1 list-disc pl-5 text-slate-600">{details.staff.map((s) => <li key={s}>{s}</li>)}</ul>
                <p className="mt-1 text-slate-500">Assigned by our team after booking.</p>
              </div>
              <label className="block"><span className="font-medium">Notes for your moderator</span> <span className="text-slate-500">(optional)</span>
                <textarea rows={3} maxLength={1000} className={inputClass} placeholder="Topics to avoid, questions to prioritize, pronunciation of names…" value={people.moderatorNotes} onChange={(e) => setPeople({ ...people, moderatorNotes: e.target.value })} /></label>
              {peopleErrors.length > 0 && <ul role="alert" className="text-red-700">{peopleErrors.map((e) => <li key={e}>{e}</li>)}</ul>}
              <div className="flex gap-2"><button className={secondaryButtonClass} onClick={() => setStep(1)}>Back</button><button className={buttonClass} onClick={nextFromPeople}>Continue</button></div>
            </div>
          )}

          {step === 3 && scheduledAt && (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-[140px_1fr] gap-y-2">
                <dt className="text-slate-500">Format</dt><dd>{price.label} ({details.minutes} minutes)</dd>
                <dt className="text-slate-500">When</dt><dd>{formatInZone(scheduledAt, timeZone)}<br /><span className="text-slate-500">AppDemo team: {formatInZone(scheduledAt, HOST_TZ)}</span></dd>
                <dt className="text-slate-500">Presenters</dt><dd>{[`${people.founderName} (${people.founderEmail})`, ...people.guests.map((g) => `${g.name} (${g.email})`)].join(", ")}</dd>
                <dt className="text-slate-500">AppDemo staff</dt><dd>{details.staff.join(", ")}</dd>
                {people.moderatorNotes && (<><dt className="text-slate-500">Moderator notes</dt><dd className="whitespace-pre-wrap">{people.moderatorNotes}</dd></>)}
              </dl>
              <div className="rounded-md border border-dashed border-slate-300 p-4 text-slate-600">
                Payment: in the live app you&apos;ll be sent to Stripe&apos;s secure checkout page here. The preview skips it and never asks for card details.
              </div>
              <label className="flex items-start gap-2"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
                <span>I understand this is a preview and no payment will be taken.</span></label>
              <div className="flex gap-2">
                <button className={secondaryButtonClass} onClick={() => setStep(2)} disabled={paying}>Back</button>
                <button className={buttonClass} onClick={pay} disabled={!agree || paying}>{paying ? "Processing…" : `Pay ${money(summary.total, summary.currency)} (preview)`}</button>
              </div>
            </div>
          )}

          {step === 4 && scheduledAt && reference && (
            <div className="space-y-3 text-sm">
              <p className="text-2xl font-bold text-emerald-700">You&apos;re booked (preview)</p>
              <p>Reference <span className="font-mono">{reference}</span>. No money was charged and nothing was saved.</p>
              <p><strong>{price.label}</strong> on {formatInZone(scheduledAt, timeZone)}.</p>
              <p>A confirmation would go to {people.founderEmail}{people.guests.length ? ` and ${people.guests.length} other presenter${people.guests.length > 1 ? "s" : ""}` : ""}.</p>
              <p className="text-slate-600">What happens next: AppDemo prepares your run-of-show, assigns your {details.staff.join(" and ").replace(/AppDemo /g, "")}, and asks you to approve the plan before the launch is locked in.</p>
              <button className={secondaryButtonClass} onClick={() => { setStep(0); setReference(null); setAgree(false); setScheduledAt(null); }}>Start over</button>
            </div>
          )}
        </section>
        {Summary}
      </div>
    </div>
  );
}
