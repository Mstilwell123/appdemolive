import { describe, expect, it } from "vitest";
import { MIN_CLICKS_PER_VARIANT, hypothesisStatusFor, verdictFor } from "@/domain/experiment";

describe("experiment verdict", () => {
  it("never calls a winner on insufficient data, however lopsided", () => {
    for (const [c, v] of [[0, 0], [0, 29], [29, 500], [3, 1]]) {
      const r = verdictFor(c, v);
      expect(r.kind).toBe("insufficient_data");
      expect(hypothesisStatusFor(r)).toBe("testing");
      expect(r.text).toMatch(/No winner/);
    }
    expect(verdictFor(MIN_CLICKS_PER_VARIANT - 1, 1000)).toMatchObject({ kind: "insufficient_data", needed: 1 });
  });
  it("treats a small difference as no clear difference", () => {
    const r = verdictFor(50, 60);
    expect(r.kind).toBe("no_clear_difference");
    expect(hypothesisStatusFor(r)).toBe("inconclusive");
  });
  it("calls a winner only on a clear difference with enough data", () => {
    expect(verdictFor(30, 80)).toMatchObject({ kind: "winner", winner: "variant" });
    expect(hypothesisStatusFor(verdictFor(30, 80))).toBe("supported");
    expect(hypothesisStatusFor(verdictFor(80, 30))).toBe("refuted");
  });
});
