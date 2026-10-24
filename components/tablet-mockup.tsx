import Image from "next/image";

/** Hero device mockup: a real screenshot of the InvoicePilot example campaign inside a hand-built CSS tablet frame. */
export function TabletMockup() {
  return (
    <figure className="relative mx-auto w-full max-w-xl [perspective:1600px]">
      <div
        aria-hidden="true"
        className="absolute inset-x-6 -bottom-6 h-10 rounded-[50%] bg-slate-900/25 blur-2xl"
      />
      <div className="relative rounded-[1.6rem] bg-gradient-to-br from-slate-700 via-slate-900 to-black p-[3.2%] shadow-2xl ring-1 ring-slate-950/40 transition-transform duration-500 motion-safe:sm:[transform:rotateY(-14deg)_rotateX(6deg)_rotateZ(-2deg)] motion-safe:sm:hover:[transform:rotateY(-6deg)_rotateX(3deg)_rotateZ(-1deg)]">
        <span aria-hidden="true" className="absolute left-1/2 top-[1.3%] h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-slate-600 ring-1 ring-slate-500/60" />
        <div className="relative overflow-hidden rounded-[0.9rem] bg-white">
          <Image
            src="/example/tablet-screen.webp"
            alt="AppDemo.live example campaign for InvoicePilot, a fictional sample app, showing the six steps from Understand to Improve and the Step 1 product truth sheet"
            width={1600}
            height={848}
            priority
            sizes="(min-width: 1024px) 576px, 92vw"
            className="h-auto w-full"
          />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-transparent to-white/25" />
          <span className="absolute bottom-2 right-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 ring-1 ring-amber-300 sm:text-xs">
            Example data
          </span>
        </div>
      </div>
    </figure>
  );
}
