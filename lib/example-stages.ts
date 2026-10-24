/** The six founder stages from PRD v1.4 §116, shared by the public example and (later) the dashboard. */
export const EXAMPLE_STAGES = [
  { id: "understand", label: "Understand", owner: "Founder + AppDemo" },
  { id: "demonstrate", label: "Demonstrate", owner: "Founder" },
  { id: "create", label: "Create", owner: "AppDemo, founder approves" },
  { id: "promote", label: "Promote", owner: "Founder posts" },
  { id: "measure", label: "Measure", owner: "AppDemo" },
  { id: "improve", label: "Improve", owner: "Founder approves" },
] as const;
export type ExampleStageId = (typeof EXAMPLE_STAGES)[number]["id"];

/** Reads "#stage-create" (or "stage-create") into a stage index; unknown values return null. */
export function stageIndexFromHash(hash: string | null | undefined): number | null {
  if (!hash) return null;
  const id = hash.replace(/^#/, "").replace(/^stage-/, "");
  const i = EXAMPLE_STAGES.findIndex((s) => s.id === id);
  return i >= 0 ? i : null;
}
export const stageHash = (id: ExampleStageId) => `#stage-${id}`;
