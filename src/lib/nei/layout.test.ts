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

  it("uses exported NEI slot frames when the dataset provides them", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Coke Oven",
        inputs: [
          { kind: "item", id: "spruce_log", amount: 15, neiSlot: { x: 48, y: 24 } },
          { kind: "fluid", id: "water", amount: 1000, neiSlot: { x: 52, y: 62 } },
        ],
        outputs: [
          { kind: "item", id: "charcoal", amount: 20, neiSlot: { x: 106, y: 24 } },
          { kind: "fluid", id: "creosote", amount: 4000, neiSlot: { x: 124, y: 62 } },
        ],
        nei: {
          slots: [
            { side: "input", kind: "item", slotIndex: 0, x: 48, y: 24 },
            { side: "input", kind: "item", slotIndex: 1, x: 66, y: 24 },
            { side: "output", kind: "item", slotIndex: 0, x: 106, y: 24 },
            { side: "input", kind: "fluid", slotIndex: 0, x: 52, y: 62 },
            { side: "output", kind: "fluid", slotIndex: 0, x: 124, y: 62 },
          ],
        },
      }),
    );

    const itemInputFrames = layout.frames.filter(
      (frame) => frame.side === "input" && frame.kind === "item",
    );
    expect(itemInputFrames).toHaveLength(2);
    expect(itemInputFrames[1]?.resource).toBeUndefined();
    expect(
      layout.slots.map((slot) => [slot.kind, slot.side, slot.resource.id, slot.x, slot.y]),
    ).toEqual([
      ["item", "input", "spruce_log", 48, 24],
      ["item", "output", "charcoal", 106, 24],
      ["fluid", "input", "water", 52, 62],
      ["fluid", "output", "creosote", 124, 62],
    ]);
    expect(layout.overflowGroups).toEqual([]);
  });

  it("uses vanilla NEI crafting table positions for shaped crafting", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Shaped Crafting",
        sourceRecipeMap: "Shaped Crafting",
        inputs: Array.from({ length: 9 }, (_, index) => ({
          kind: "item",
          id: `input-${index}`,
          amount: 1,
        })),
        outputs: [{ kind: "item", id: "output", amount: 1 }],
        nei: {
          itemInputGrid: { width: 3, height: 3 },
          itemOutputGrid: { width: 1, height: 1 },
        },
      }),
    );

    expect(layout.id).toBe("shaped-crafting");
    expect(layout.frames.filter((frame) => frame.side === "input" && frame.kind === "item")).toHaveLength(
      9,
    );
    expect(layout.slots.map((slot) => [slot.kind, slot.side, slot.x, slot.y])).toEqual([
      ["item", "input", 25, 8],
      ["item", "input", 43, 8],
      ["item", "input", 61, 8],
      ["item", "input", 25, 26],
      ["item", "input", 43, 26],
      ["item", "input", 61, 26],
      ["item", "input", 25, 44],
      ["item", "input", 43, 44],
      ["item", "input", 61, 44],
      ["item", "output", 124, 26],
    ]);
    expect(layout.progressBars[0]).toMatchObject({ x: 84, y: 26, texture: "arrow" });
  });

  it("keeps legacy ore dictionary crafting maps on the vanilla crafting layout", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Crafting Table (Ore Dictionary)",
        sourceRecipeMap: "Crafting Table (Ore Dictionary)",
        inputs: [{ kind: "item", id: "oredict:stickWood", amount: 1 }],
        outputs: [{ kind: "item", id: "output", amount: 1 }],
        nei: {
          itemInputGrid: { width: 3, height: 3 },
          itemOutputGrid: { width: 1, height: 1 },
        },
      }),
    );

    expect(layout.id).toBe("shaped-crafting");
    expect(layout.frames.filter((frame) => frame.side === "input" && frame.kind === "item")).toHaveLength(
      9,
    );
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
    expect(layout.frames).toHaveLength(24);
    expect(layout.frames.filter((frame) => !frame.resource)).toHaveLength(20);
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

  it("keeps empty centrifuge output slots when only some outputs are used", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Centrifuge",
        sourceRecipeMap: "Centrifuge",
        inputs: [
          { kind: "item", id: "dust", amount: 1 },
          { kind: "fluid", id: "water", amount: 1000 },
        ],
        outputs: [
          { kind: "item", id: "red", amount: 1 },
          { kind: "item", id: "green", amount: 1 },
          { kind: "item", id: "black", amount: 1 },
          { kind: "fluid", id: "oxygen", amount: 1000 },
        ],
        nei: {
          itemInputGrid: { width: 1, height: 1 },
          itemOutputGrid: { width: 3, height: 1 },
          fluidOutputGrid: { width: 1, height: 1 },
        },
      }),
    );

    const itemOutputFrames = layout.frames.filter(
      (frame) => frame.kind === "item" && frame.side === "output",
    );
    const itemInputFrames = layout.frames.filter(
      (frame) => frame.kind === "item" && frame.side === "input",
    );
    const fluidInputFrames = layout.frames.filter(
      (frame) => frame.kind === "fluid" && frame.side === "input",
    );

    expect(itemInputFrames).toHaveLength(2);
    expect(itemInputFrames.filter((frame) => frame.resource)).toHaveLength(1);
    expect(fluidInputFrames).toHaveLength(1);
    expect(fluidInputFrames.filter((frame) => frame.resource)).toHaveLength(1);
    expect(itemOutputFrames).toHaveLength(6);
    expect(itemOutputFrames.filter((frame) => frame.resource)).toHaveLength(3);
    expect(itemOutputFrames.map((frame) => [frame.x, frame.y])).toEqual([
      [106, 8],
      [124, 8],
      [142, 8],
      [106, 26],
      [124, 26],
      [142, 26],
    ]);
  });

  it("does not collapse Blast Furnace into the plain furnace layout", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Blast Furnace",
        sourceRecipeMap: "Blast Furnace",
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [
          { kind: "item", id: "ingot", amount: 1 },
          { kind: "fluid", id: "chlorine", amount: 87 },
        ],
      }),
    );

    expect(layout.id).toBe("blast-furnace");
    expect(layout.overflowGroups).toEqual([]);
    expect(
      layout.frames.filter((frame) => frame.kind === "item" && frame.side === "input"),
    ).toHaveLength(6);
    expect(
      layout.frames.filter((frame) => frame.kind === "item" && frame.side === "output"),
    ).toHaveLength(6);
    expect(
      layout.frames.filter((frame) => frame.kind === "fluid" && frame.side === "input"),
    ).toHaveLength(1);
    expect(
      layout.frames.filter((frame) => frame.kind === "fluid" && frame.side === "output"),
    ).toHaveLength(1);
  });

  it("uses enriched recipe map slot capacities for partial electrolyzer outputs", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Electrolyzer",
        sourceRecipeMap: "Electrolyzer",
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [
          { kind: "item", id: "a", amount: 1 },
          { kind: "item", id: "b", amount: 1 },
          { kind: "item", id: "c", amount: 1 },
        ],
        nei: {
          slotCapacity: {
            maxItemOutputs: 6,
          },
        },
      }),
    );

    const itemOutputFrames = layout.frames.filter(
      (frame) => frame.kind === "item" && frame.side === "output",
    );

    expect(itemOutputFrames).toHaveLength(6);
    expect(itemOutputFrames.filter((frame) => frame.resource)).toHaveLength(3);
  });

  it("keeps known machine empty slots for exported recipe map name variants", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Chemical Plant",
        sourceRecipeMap: "chemical plant recipe map",
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [{ kind: "fluid", id: "acid", amount: 1000 }],
      }),
    );

    expect(layout.id).toBe("gtpp-chemical-plant");
    expect(
      layout.frames.filter((frame) => frame.kind === "item" && frame.side === "input"),
    ).toHaveLength(4);
    expect(
      layout.frames.filter((frame) => frame.kind === "item" && frame.side === "output"),
    ).toHaveLength(6);
    expect(
      layout.frames.filter((frame) => frame.kind === "fluid" && frame.side === "input"),
    ).toHaveLength(4);
    expect(
      layout.frames.filter((frame) => frame.kind === "fluid" && frame.side === "output"),
    ).toHaveLength(3);
  });

  it("marks known machine output overflow without changing the full expanded layout", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Centrifuge",
        sourceRecipeMap: "Centrifuge",
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: Array.from({ length: 10 }, (_, index) => ({
          kind: "item",
          id: `byproduct-${index}`,
          amount: 1,
          chance: 0.1,
        })),
      }),
    );

    const itemOutputFrames = layout.frames.filter(
      (frame) => frame.kind === "item" && frame.side === "output",
    );

    expect(itemOutputFrames).toHaveLength(10);
    expect(layout.overflowGroups).toEqual([
      { side: "output", kind: "item", capacity: 6, resourceCount: 10 },
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

  it("uses machine-specific GregTech progress textures", () => {
    const cases = [
      ["Extruder", "extrude"],
      ["Wiremill", "wiremill"],
      ["Fluid Heater", "arrow_multiple"],
      ["Distillery", "arrow_multiple"],
      ["Chemical Reactor", "arrow_multiple"],
      ["Centrifuge", "extract"],
      ["Electrolyzer", "extract"],
      ["Electromagnetic Separator", "magnet"],
      ["Temperature Fluctuation", "water_plasma_heater"],
      ["Slicer", "slice"],
    ] as const;

    for (const [sourceRecipeMap, texture] of cases) {
      expect(
        getNeiRecipeLayout(
          recipe({
            machineType: sourceRecipeMap,
            sourceRecipeMap,
            inputs: [{ kind: "item", id: "input", amount: 1 }],
            outputs: [{ kind: "item", id: "output", amount: 1 }],
          }),
        ).progressBars[0]?.texture,
      ).toBe(texture);
    }
  });
});

function recipe({
  machineType,
  sourceRecipeMap,
  inputs,
  outputs,
  nei,
}: {
  machineType: string;
  sourceRecipeMap?: string;
  inputs: Recipe["inputs"];
  outputs: Recipe["outputs"];
  nei?: Recipe["nei"];
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
    nei,
    source: sourceRecipeMap ? { recipeMap: sourceRecipeMap } : undefined,
  };
}
