import { describe, expect, it } from "vitest";
import type { FactoryNode, Recipe } from "./types";
import {
  applyRecipeInputOverrides,
  restoreCrossKindInputOverrideVisuals,
} from "./recipe-input-overrides";

describe("recipe input overrides", () => {
  it("keeps cross-kind filled-cell overrides calculable but restores the cell for display", () => {
    const recipe: Recipe = {
      id: "oxygen-cell-consumer",
      name: "Oxygen Cell Consumer",
      machineType: "Chemical Reactor",
      minimumTier: "LV",
      durationTicks: 20,
      eut: 30,
      inputs: [
        {
          kind: "item",
          id: "gregtech:gt.metaitem.01@32000",
          amount: 1,
          displayName: "Oxygen Cell",
          iconPath: "/items/oxygen-cell.png",
          alternatives: [{ kind: "fluid", id: "oxygen", displayName: "Oxygen" }],
          neiSlot: { x: 34, y: 17 },
        },
      ],
      outputs: [{ kind: "item", id: "dust", amount: 1 }],
    };
    const node: Pick<FactoryNode, "recipeInputOverrides"> = {
      recipeInputOverrides: {
        "0": {
          ...recipe.inputs[0],
          kind: "fluid",
          id: "oxygen",
          amount: 1000,
          displayName: "Oxygen",
          iconPath: "/fluids/oxygen.png",
          alternatives: undefined,
        },
      },
    };

    const effectiveRecipe = applyRecipeInputOverrides(recipe, node);
    expect(effectiveRecipe.inputs[0]).toEqual(
      expect.objectContaining({
        kind: "fluid",
        id: "oxygen",
        amount: 1000,
      }),
    );

    const displayRecipe = restoreCrossKindInputOverrideVisuals(effectiveRecipe, recipe, node);
    expect(displayRecipe.inputs[0]).toEqual(
      expect.objectContaining({
        kind: "item",
        id: "gregtech:gt.metaitem.01@32000",
        amount: 1,
        displayName: "Oxygen Cell",
        iconPath: "/items/oxygen-cell.png",
      }),
    );
  });
});
