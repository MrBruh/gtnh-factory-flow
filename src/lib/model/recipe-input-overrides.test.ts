import { describe, expect, it } from "vitest";
import type { FactoryNode, Recipe } from "./types";
import {
  applyRecipeInputOverrides,
  remapMigratedRecipeInputOverrides,
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

describe("remapping input overrides onto a migrated recipe", () => {
  const logWood = (amount = 1) => ({
    kind: "item" as const,
    id: "item:oredict:logWood",
    amount,
    displayName: "Any Log",
    alternatives: [
      { kind: "item" as const, id: "item:spruce_log", displayName: "Spruce Log" },
      { kind: "item" as const, id: "item:oak_log", displayName: "Oak Log" },
    ],
  });
  const water = (amount = 1000) => ({ kind: "fluid" as const, id: "water", amount });
  const spruceOverride = {
    kind: "item" as const,
    id: "item:spruce_log",
    amount: 1,
    displayName: "Spruce Log",
  };

  const recipeWith = (inputs: Recipe["inputs"], id = "r"): Recipe => ({
    id,
    name: "Sawmill",
    machineType: "Sawmill",
    minimumTier: "LV",
    durationTicks: 100,
    eut: 30,
    inputs,
    outputs: [{ kind: "item", id: "item:plank", amount: 6 }],
  });

  it("follows the concrete pick when the migrated recipe reorders its slots", () => {
    const previous = recipeWith([water(), logWood()]);
    const next = recipeWith([logWood(), water()], "r2");

    const remapped = remapMigratedRecipeInputOverrides({ "1": spruceOverride }, previous, next);

    // the logWood slot moved from index 1 to index 0, and the pick has to move with it
    expect(remapped).toEqual({ "0": spruceOverride });
    expect(applyRecipeInputOverrides(next, { recipeInputOverrides: remapped }).inputs[0]).toEqual(
      expect.objectContaining({ id: "item:spruce_log" }),
    );
  });

  it("leaves overrides untouched when slot order did not move", () => {
    const previous = recipeWith([logWood(), water()]);
    const next = recipeWith([logWood(), water()], "r2");

    expect(remapMigratedRecipeInputOverrides({ "0": spruceOverride }, previous, next)).toEqual({
      "0": spruceOverride,
    });
  });

  it("keeps a pick on its own index when an identical slot could also have claimed it", () => {
    const previous = recipeWith([logWood(), logWood()]);
    const next = recipeWith([logWood(), logWood()], "r2");

    // index 0 is free and matches, but the override belongs to index 1 and must stay there
    expect(remapMigratedRecipeInputOverrides({ "1": spruceOverride }, previous, next)).toEqual({
      "1": spruceOverride,
    });
  });

  it("gives two picks on identical slots one slot each", () => {
    const oakOverride = { ...spruceOverride, id: "item:oak_log", displayName: "Oak Log" };
    const previous = recipeWith([logWood(), logWood()]);
    const next = recipeWith([logWood(), logWood()], "r2");

    expect(
      remapMigratedRecipeInputOverrides({ "0": spruceOverride, "1": oakOverride }, previous, next),
    ).toEqual({ "0": spruceOverride, "1": oakOverride });
  });

  it("drops a pick the migrated recipe has no slot for, rather than guessing", () => {
    const previous = recipeWith([logWood(), water()]);
    const next = recipeWith([{ kind: "item", id: "item:oredict:plankWood", amount: 1 }], "r2");

    expect(
      remapMigratedRecipeInputOverrides({ "0": spruceOverride }, previous, next),
    ).toBeUndefined();
  });

  it("drops a pick the migrated slot no longer accepts", () => {
    const previous = recipeWith([logWood()]);
    // same oredict slot id, but spruce is no longer one of its alternatives
    const next = recipeWith(
      [
        {
          ...logWood(),
          alternatives: [{ kind: "item" as const, id: "item:oak_log", displayName: "Oak Log" }],
        },
      ],
      "r2",
    );

    expect(
      remapMigratedRecipeInputOverrides({ "0": spruceOverride }, previous, next),
    ).toBeUndefined();
  });

  it("ignores an override pointing past the end of the old recipe", () => {
    const previous = recipeWith([logWood()]);
    const next = recipeWith([logWood()], "r2");

    expect(
      remapMigratedRecipeInputOverrides({ "7": spruceOverride }, previous, next),
    ).toBeUndefined();
  });
});
