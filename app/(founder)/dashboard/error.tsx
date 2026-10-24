"use client";
export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-900">
      <h2 className="font-semibold">Something went wrong on this page</h2>
      <p className="mt-1 text-sm">Try again. If it keeps happening, contact support@pragvance.ai.</p>
      <button onClick={reset} className="mt-3 rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white">Try again</button>
    </div>
  );
}
