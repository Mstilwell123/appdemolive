export function SetupNotice() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-amber-900">
      <h2 className="font-semibold">The database isn&apos;t connected yet</h2>
      <p className="mt-1 text-sm">
        Set <code>DATABASE_URL</code> and <code>BETTER_AUTH_SECRET</code> (see <code>.env.example</code>) and run{" "}
        <code>npm run db:migrate</code> to turn on accounts and launches. Nothing is shown here until then, so no sample
        data is ever displayed.
      </p>
    </div>
  );
}
