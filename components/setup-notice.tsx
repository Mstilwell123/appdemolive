export function SetupNotice() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-amber-900">
      <h2 className="font-semibold">The database isn&apos;t connected yet</h2>
      <p className="mt-1 text-sm">
        Add the Supabase variables listed in <code>.env.example</code> and apply <code>supabase/migrations</code> to
        turn on accounts and launches. Nothing is shown here until then, so no sample data is ever displayed.
      </p>
    </div>
  );
}
