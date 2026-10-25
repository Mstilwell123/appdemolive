/**
 * Keyboard model for WAI-ARIA tabs (automatic activation), shared by the public stage navigator
 * and the sample-plan tabs. Pure so it can be unit-tested without a DOM.
 */
export function tabKeyTarget(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
