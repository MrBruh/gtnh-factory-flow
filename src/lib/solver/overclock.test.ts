import { describe, expect, it } from "vitest";
import { getOverclockedRecipeStats } from "./overclock";

describe("GT overclocking", () => {
  it("treats MAX as a filter/display tier instead of an extra overclock voltage", () => {
    const stats = getOverclockedRecipeStats(
      {
        minimumTier: "MV",
        durationTicks: 80,
        eut: 120,
        machineType: "Alloy Blast Smelter",
      },
      {
        overclockTier: "MAX",
      },
    );

    expect(stats.tier).toBe("OpV");
    expect(stats.overclockSteps).toBe(11);
    expect(stats.eut).toBe(120 * 4 ** 11);
  });
});
