import { describe, expect, it } from "vitest";
import { stageInfo } from "@/domain/launch-stages";
import { EXCEPTION_STATUSES, LAUNCH_STATUSES } from "@/types/launch";

describe("founder stages", () => {
  it("describes every status in plain words", () => {
    for (const s of LAUNCH_STATUSES) {
      const i = stageInfo(s);
      expect(i.label.length).toBeGreaterThan(0);
      expect(i.whatsNext.length).toBeGreaterThan(0);
    }
  });
  it("keeps exception statuses out of the progress bar", () => {
    for (const s of EXCEPTION_STATUSES) expect(stageInfo(s).stage).toBeNull();
  });
});
