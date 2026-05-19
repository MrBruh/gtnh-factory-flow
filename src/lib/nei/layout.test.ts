import { describe, expect, it } from "vitest";
import { getNeiRecipeLayout } from "./layout";
import type { Recipe } from "@/lib/model/types";

describe("NEI layout", () => {
  it("uses GregTech default dynamic slots instead of fixed 3x3 grids", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Ore Washer",
        inputs: [
          { kind: "item", id: "ore", amount: 1 },
          { kind: "fluid", id: "water", amount: 1000 },
        ],
        outputs: [
          { kind: "item", id: "dust", amount: 1 },
          { kind: "item", id: "stone", amount: 1 },
          { kind: "item", id: "byproduct", amount: 1 },
        ],
      }),
    );

    expect(layout.slots.map((slot) => [slot.kind, slot.side, slot.x, slot.y])).toEqual([
      ["item", "input", 52, 24],
      ["fluid", "input", 52, 62],
      ["item", "output", 106, 24],
      ["item", "output", 124, 24],
      ["item", "output", 142, 24],
    ]);
  });

  it("uses the LargeNEIFrontend positions for the Large Chemical Reactor", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Large Chemical Reactor",
        sourceRecipeMap: "Large Chemical Reactor",
        inputs: [
          { kind: "item", id: "circuit", amount: 1 },
          { kind: "item", id: "dust", amount: 1 },
          { kind: "fluid", id: "input-fluid", amount: 250 },
        ],
        outputs: [{ kind: "item", id: "output", amount: 1 }],
      }),
    );

    expect(layout.id).toBe("large-nei");
    expect(layout.logo).toEqual({ x: 80, y: 62 });
    expect(layout.slots.map((slot) => [slot.kind, slot.side, slot.x, slot.y])).toEqual([
      ["item", "input", 16, 8],
      ["item", "input", 34, 8],
      ["fluid", "input", 16, 44],
      ["item", "output", 106, 8],
    ]);
  });

  it("uses distillation tower output column ordering", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Distillation Tower",
        sourceRecipeMap: "Distillation Tower",
        inputs: [{ kind: "fluid", id: "oil", amount: 1000 }],
        outputs: [
          { kind: "item", id: "dust", amount: 1 },
          { kind: "fluid", id: "light", amount: 100 },
          { kind: "fluid", id: "heavy", amount: 100 },
          { kind: "fluid", id: "residue", amount: 100 },
        ],
      }),
    );

    expect(
      layout.slots
        .filter((slot) => slot.kind === "fluid" && slot.side === "output")
        .map((slot) => [slot.x, slot.y]),
    ).toEqual([
      [124, 62],
      [142, 62],
      [106, 44],
    ]);
  });

  it("uses FluidOnlyFrontend positions for fusion fluids", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Fusion Reactor",
        sourceRecipeMap: "Fusion Reactor",
        inputs: [
          { kind: "fluid", id: "deuterium", amount: 1000 },
          { kind: "fluid", id: "tritium", amount: 1000 },
        ],
        outputs: [{ kind: "fluid", id: "helium_plasma", amount: 1000 }],
      }),
    );

    expect(layout.id).toBe("fluid-only");
    expect(layout.slots.map((slot) => [slot.kind, slot.side, slot.x, slot.y])).toEqual([
      ["fluid", "input", 34, 24],
      ["fluid", "input", 52, 24],
      ["fluid", "output", 106, 24],
    ]);
  });
});

function recipe({
  machineType,
  sourceRecipeMap,
  inputs,
  outputs,
}: {
  machineType: string;
  sourceRecipeMap?: string;
  inputs: Recipe["inputs"];
  outputs: Recipe["outputs"];
}): Recipe {
  return {
    id: machineType,
    name: machineType,
    machineType,
    minimumTier: "LV",
    durationTicks: 20,
    eut: 8,
    inputs,
    outputs,
    source: sourceRecipeMap ? { recipeMap: sourceRecipeMap } : undefined,
  };
}
