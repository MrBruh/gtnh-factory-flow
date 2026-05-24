import { describe, expect, it } from "vitest";
import {
  applyMachineHandlerToRecipe,
  getRecipeMachineHandlers,
  getSelectedMachineHandler,
} from "./recipe-rules";
import type { Recipe } from "./types";

describe("recipe machine handlers", () => {
  it("uses machine handlers exported in the dataset", () => {
    const recipe = {
      ...testRecipe("Fluid Extractor"),
      machineHandlers: [
        {
          id: "nei-catalyst-multiblock-fluid-extractor",
          label: "Multiblock Fluid Extractor",
          machineType: "Multiblock Fluid Extractor",
          minimumTier: "LV",
          kind: "multiblock" as const,
        },
      ],
    };

    expect(getRecipeMachineHandlers(recipe).map((handler) => handler.label)).toEqual([
      "Fluid Extractor",
      "Multiblock Fluid Extractor",
    ]);
  });

  it("applies the selected handler to the effective recipe", () => {
    const recipe = {
      ...testRecipe("Shaped Crafting", "NONE"),
      machineHandlers: [
        {
          id: "autoworkbench",
          label: "Autoworkbench",
          machineType: "Autoworkbench",
          minimumTier: "LV",
          kind: "automation" as const,
        },
      ],
    };
    const effective = applyMachineHandlerToRecipe(recipe, {
      machineHandlerId: "autoworkbench",
    });

    expect(getSelectedMachineHandler(recipe, { machineHandlerId: "autoworkbench" })).toMatchObject({
      label: "Autoworkbench",
      minimumTier: "LV",
    });
    expect(effective).toMatchObject({
      machineType: "Autoworkbench",
      minimumTier: "LV",
      machineProfile: {
        machineType: "Autoworkbench",
        minimumTier: "LV",
      },
    });
  });
});

function testRecipe(machineType: string, minimumTier = "LV"): Recipe {
  return {
    id: machineType,
    name: machineType,
    machineType,
    minimumTier,
    durationTicks: 20,
    eut: 8,
    inputs: [{ kind: "item", id: "input", amount: 1 }],
    outputs: [{ kind: "item", id: "output", amount: 1 }],
    source: { recipeMap: machineType },
  };
}
