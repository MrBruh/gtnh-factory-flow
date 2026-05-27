import { describe, expect, it } from "vitest";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import { applyMachineHandlerToRecipe } from "@/lib/model/recipe-rules";
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

  it("applies bee frame output through the Forestry production formula", () => {
    const recipe = enrichPassiveProductionRecipe(testBeeRecipe());
    const emptyNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: {},
    };
    const provenFramesNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: {
        beeFrameSlot1: "forestry:proven",
        beeFrameSlot2: "forestry:proven",
        beeFrameSlot3: "forestry:proven",
      },
    };

    expect(getMachineOutputMultiplier(recipe, emptyNode, recipe.outputs[0]!, "LV")).toBe(1);
    expect(
      getMachineOutputMultiplier(recipe, provenFramesNode, recipe.outputs[0]!, "LV"),
    ).toBeCloseTo(Math.pow(31, 0.52));
  });

  it("applies bee machine handler production terms", () => {
    const recipe = enrichPassiveProductionRecipe(testBeeRecipe());
    const node: Pick<FactoryNode, "machineConfigTiers" | "machineHandlerId"> = {
      machineConfigTiers: {},
      machineHandlerId: "alveary",
    };
    const alvearyRecipe = applyMachineHandlerToRecipe(recipe, node);

    expect(getMachineOutputMultiplier(alvearyRecipe, node, recipe.outputs[0]!, "LV")).toBeCloseTo(
      Math.pow(10, 0.52),
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

function testBeeRecipe(): Recipe {
  return {
    id: "bee-explosive",
    name: "Bee Production: Explosive Bee",
    machineType: "Bee Production",
    minimumTier: "NONE",
    durationTicks: 550,
    eut: 0,
    inputs: [
      {
        kind: "item",
        id: "factoryflow:bee_species:gregtech-explosive",
        amount: 1,
        displayName: "Explosive Bee",
        consumed: false,
      },
    ],
    outputs: [{ kind: "item", id: "IC2:blockITNT", amount: 0.02, displayName: "Industrial TNT" }],
    source: { recipeMap: "Bee Production" },
  };
}
