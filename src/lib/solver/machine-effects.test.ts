import { describe, expect, it } from "vitest";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import { enrichPassiveProductionRecipe } from "@/lib/model/passive-production";
import { getMachineDurationMultiplier, getMachineOutputMultiplier } from "./machine-effects";

describe("passive production machine effects", () => {
  it("applies IC2 crop stat presets as generic config multipliers", () => {
    const recipe = enrichPassiveProductionRecipe(testCropRecipe());
    const lowStatsNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: { cropStats: "1-1-1" },
    };
    const gainNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: { cropStats: "23-31-0" },
    };

    expect(getMachineDurationMultiplier(recipe, lowStatsNode)).toBeCloseTo(3.102);
    expect(getMachineOutputMultiplier(recipe, lowStatsNode, recipe.outputs[0]!, "LV")).toBeCloseTo(
      0.866,
    );
    expect(getMachineDurationMultiplier(recipe, gainNode)).toBe(1);
    expect(getMachineOutputMultiplier(recipe, gainNode, recipe.outputs[0]!, "LV")).toBeCloseTo(
      2.741,
    );
  });
});

function testCropRecipe(): Recipe {
  return {
    id: "ic2-crop-stickle",
    name: "IC2 Crop: Stickreed",
    machineType: "IC2 Crop",
    minimumTier: "NONE",
    durationTicks: 1200,
    eut: 0,
    inputs: [
      {
        kind: "item",
        id: "IC2:itemCropSeed@1",
        amount: 1,
        displayName: "Stickreed Seeds",
        consumed: false,
      },
    ],
    outputs: [{ kind: "item", id: "IC2:itemHarz", amount: 1, displayName: "Sticky Resin" }],
    source: { recipeMap: "IC2 Crop" },
  };
}
