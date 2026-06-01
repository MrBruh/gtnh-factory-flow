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
          { kind: "item", id: "sapling", amount: 1, consumed: false, neiSlot: { x: 88, y: 8 } },
          { kind: "item", id: "spruce_log", amount: 15, neiSlot: { x: 48, y: 24 } },
          { kind: "fluid", id: "water", amount: 1000, neiSlot: { x: 52, y: 62 } },
        ],
        outputs: [
          { kind: "item", id: "charcoal", amount: 20, neiSlot: { x: 106, y: 24 } },
          { kind: "fluid", id: "creosote", amount: 4000, neiSlot: { x: 124, y: 62 } },
        ],
        nei: {
          slots: [
            { side: "input", kind: "item", slotIndex: 100000, x: 88, y: 8 },
            { side: "input", kind: "item", slotIndex: 0, x: 48, y: 24 },
            { side: "input", kind: "item", slotIndex: 1, x: 66, y: 24 },
            { side: "output", kind: "item", slotIndex: 0, x: 106, y: 24 },
            { side: "input", kind: "fluid", slotIndex: 0, x: 52, y: 62 },
            { side: "output", kind: "fluid", slotIndex: 0, x: 124, y: 62 },
          ],
          progressBars: [{ x: 84, y: 44, width: 20, height: 18, direction: "right" }],
        },
      }),
    );

    const itemInputFrames = layout.frames.filter(
      (frame) => frame.side === "input" && frame.kind === "item",
    );
    expect(itemInputFrames).toHaveLength(3);
    expect(itemInputFrames[2]?.resource).toBeUndefined();
    expect(
      layout.slots.map((slot) => [slot.kind, slot.side, slot.resource.id, slot.x, slot.y]),
    ).toEqual([
      ["item", "input", "sapling", 88, 8],
      ["item", "input", "spruce_log", 48, 24],
      ["item", "output", "charcoal", 106, 24],
      ["fluid", "input", "water", 52, 62],
      ["fluid", "output", "creosote", 124, 62],
    ]);
    expect(layout.progressBars).toEqual([
      { x: 84, y: 44, width: 20, height: 18, direction: "right", texture: "sift" },
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
    expect(
      layout.frames.filter((frame) => frame.side === "input" && frame.kind === "item"),
    ).toHaveLength(9);
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
    expect(
      layout.frames.filter((frame) => frame.side === "input" && frame.kind === "item"),
    ).toHaveLength(9);
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

  it("uses a dedicated NEI layout for the Component Assembly Line", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Component Assembly Line",
        sourceRecipeMap: "Component Assembly Line",
        inputs: [
          { kind: "item", id: "component-a", amount: 1, neiSlot: { x: 97, y: 17 } },
          { kind: "item", id: "component-b", amount: 1, neiSlot: { x: 115, y: 17 } },
          { kind: "fluid", id: "solder", amount: 144, neiSlot: { x: 97, y: 35 } },
        ],
        outputs: [{ kind: "item", id: "assembled", amount: 1, neiSlot: { x: 142, y: 17 } }],
        nei: {
          itemInputGrid: { width: 3, height: 4 },
          fluidInputGrid: { width: 4, height: 3 },
          slots: [
            { side: "input", kind: "item", slotIndex: 0, x: 97, y: 17 },
            { side: "input", kind: "fluid", slotIndex: 0, x: 97, y: 35 },
            { side: "output", kind: "item", slotIndex: 0, x: 142, y: 17 },
          ],
          progressBars: [{ x: 80, y: 44, width: 20, height: 18, direction: "right" }],
        },
      }),
    );

    expect(layout.id).toBe("component-assembly-line");
    expect(layout.canvas).toEqual({ width: 170, height: 112 });
    expect(layout.progressBars).toEqual([]);
    expect(layout.decorations).toEqual([
      { x: 70, y: 19, width: 82, height: 1, color: "#373737" },
      { x: 70, y: 20, width: 82, height: 1, color: "#8B8B8B" },
      { x: 70, y: 21, width: 82, height: 1, color: "#ffffff" },
      { x: 141, y: 25, width: 11, height: 1, color: "#030303" },
      { x: 142, y: 26, width: 10, height: 1, color: "#373737" },
      { x: 143, y: 27, width: 9, height: 1, color: "#8B8B8B" },
      { x: 141, y: 25, width: 1, height: 18, color: "#030303" },
      { x: 142, y: 26, width: 1, height: 18, color: "#373737" },
      { x: 143, y: 27, width: 1, height: 18, color: "#8B8B8B" },
    ]);
    expect(
      layout.frames
        .filter((frame) => frame.side === "input" && frame.kind === "item")
        .map((frame) => [frame.x, frame.y]),
    ).toEqual([
      [16, 17],
      [34, 17],
      [52, 17],
      [16, 35],
      [34, 35],
      [52, 35],
      [16, 53],
      [34, 53],
      [52, 53],
      [16, 71],
      [34, 71],
      [52, 71],
    ]);
    expect(
      layout.frames
        .filter((frame) => frame.side === "input" && frame.kind === "fluid")
        .map((frame) => [frame.x, frame.y]),
    ).toEqual([
      [97, 35],
      [115, 35],
      [133, 35],
      [151, 35],
      [97, 53],
      [115, 53],
      [133, 53],
      [151, 53],
      [97, 71],
      [115, 71],
      [133, 71],
      [151, 71],
    ]);
    expect(
      layout.frames
        .filter((frame) => frame.side === "output" && frame.kind === "item")
        .map((frame) => [frame.x, frame.y]),
    ).toEqual([[151, 17]]);
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

  it("uses the Bee Produce recipe surface", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Bee Produce",
        sourceRecipeMap: "Bee Produce",
        inputs: [{ kind: "item", id: "factoryflow:bee_species:hydra", amount: 1 }],
        outputs: [
          { kind: "item", id: "GTPlusPlus:hydraComb", amount: 0.06 },
          { kind: "item", id: "MagicBees:comb@1", amount: 0.1 },
        ],
      }),
    );

    expect(layout.id).toBe("bee-produce");
    expect(layout.canvas.width).toBe(170);
    expect(layout.slots.map((slot) => [slot.kind, slot.side, slot.x, slot.y])).toEqual([
      ["item", "input", 48, 35],
      ["item", "output", 106, 17],
      ["item", "output", 124, 17],
    ]);
    expect(
      layout.frames.filter((frame) => frame.side === "output").map((frame) => [frame.x, frame.y]),
    ).toEqual([
      [106, 17],
      [124, 17],
      [142, 17],
      [106, 53],
      [124, 53],
      [142, 53],
    ]);
    expect(layout.progressBars[0]).toMatchObject({ x: 80, y: 35, texture: "arrow" });
  });

  it("reuses the Bee Produce surface for bee machines", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Industrial Apiary",
        inputs: [{ kind: "item", id: "factoryflow:bee_species:explosive", amount: 1 }],
        outputs: [{ kind: "item", id: "IC2:blockITNT", amount: 1, chance: 0.2 }],
      }),
    );

    expect(layout.id).toBe("bee-produce");
    expect(layout.slots.map((slot) => [slot.kind, slot.side, slot.x, slot.y])).toEqual([
      ["item", "input", 48, 35],
      ["item", "output", 106, 17],
    ]);
    expect(layout.frames.filter((frame) => frame.side === "output")).toHaveLength(6);
  });

  it("centers bee machine recipes even when the dataset provides raw NEI slots", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Industrial Apiary",
        inputs: [
          {
            kind: "item",
            id: "factoryflow:bee_species:explosive",
            amount: 1,
            neiSlot: { x: 34, y: 52 },
          },
        ],
        outputs: [
          {
            kind: "item",
            id: "IC2:blockITNT",
            amount: 1,
            chance: 0.2,
            neiSlot: { x: 106, y: 26 },
          },
        ],
        nei: {
          slots: [
            { side: "input", kind: "item", slotIndex: 0, x: 34, y: 52 },
            { side: "output", kind: "item", slotIndex: 0, x: 106, y: 26 },
          ],
          progressBars: [{ x: 66, y: 52, width: 24, height: 17, direction: "right" }],
        },
      }),
    );

    expect(layout.slots.map((slot) => [slot.kind, slot.side, slot.x, slot.y])).toEqual([
      ["item", "input", 48, 35],
      ["item", "output", 106, 17],
    ]);
    expect(layout.progressBars[0]).toMatchObject({ x: 80, y: 35, texture: "arrow" });
  });

  it("aligns crop production arrows with the crop slots", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Crop Manager",
        sourceRecipeMap: "IC2 Crop",
        inputs: [
          {
            kind: "item",
            id: "factoryflow:ic2_crop_seed:spruce-bonsai",
            amount: 1,
            neiSlot: { x: 34, y: 35 },
          },
        ],
        outputs: [
          { kind: "item", id: "minecraft:spruce_log", amount: 16.79, neiSlot: { x: 124, y: 35 } },
          { kind: "item", id: "minecraft:sapling", amount: 1.52, neiSlot: { x: 142, y: 35 } },
        ],
      }),
    );

    expect(layout.progressBars[0]).toMatchObject({ x: 78, y: 35, texture: "arrow" });
  });

  it("uses exported Thaumcraft infusion slots instead of a generic machine row", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Thaumcraft Infusion",
        sourceRecipeMap: "Thaumcraft Infusion",
        inputs: [
          { kind: "item", id: "central", amount: 1, neiSlot: { x: 75, y: 58 } },
          { kind: "item", id: "component-a", amount: 1, neiSlot: { x: 75, y: 19 } },
          { kind: "item", id: "component-b", amount: 1, neiSlot: { x: 115, y: 59 } },
          { kind: "aspect", id: "thaumcraft:aspect:ordo", amount: 8, neiSlot: { x: 75, y: 114 } },
        ],
        outputs: [{ kind: "item", id: "infused", amount: 1, neiSlot: { x: 75, y: 1 } }],
        nei: {
          slots: [
            { side: "input", kind: "item", slotIndex: 0, x: 75, y: 58 },
            { side: "input", kind: "item", slotIndex: 1, x: 75, y: 19 },
            { side: "input", kind: "item", slotIndex: 2, x: 115, y: 59 },
            { side: "input", kind: "aspect", slotIndex: 0, x: 75, y: 114 },
            { side: "output", kind: "item", slotIndex: 0, x: 75, y: 1 },
          ],
          progressBars: [],
        },
      }),
    );

    expect(layout.id).toBe("thaumcraft-infusion");
    expect(layout.canvas).toMatchObject({ width: 214, height: 140 });
    expect(layout.decorations[0]).toMatchObject({
      kind: "texture",
      imagePath: "/nei/thaumcraft/gui/gui_researchbook_overlay.png",
      sourceX: 0,
      sourceY: 3,
    });
    expect(
      layout.slots.map((slot) => [slot.kind, slot.side, slot.resource.id, slot.x, slot.y]),
    ).toEqual([
      ["item", "input", "central", 75, 58],
      ["item", "input", "component-a", 75, 19],
      ["item", "input", "component-b", 115, 59],
      ["aspect", "input", "thaumcraft:aspect:ordo", 75, 114],
      ["item", "output", "infused", 75, 1],
    ]);
    expect(layout.progressBars).toEqual([]);
  });

  it("uses Thaumcraft crucible NEI plugin positions for aspects and catalyst", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Thaumcraft Crucible",
        sourceRecipeMap: "Thaumcraft Crucible",
        inputs: [
          { kind: "item", id: "catalyst", amount: 1, neiSlot: { x: 51, y: 30 } },
          { kind: "aspect", id: "thaumcraft:aspect:aer", amount: 4, neiSlot: { x: 61, y: 79 } },
          { kind: "aspect", id: "thaumcraft:aspect:ordo", amount: 8, neiSlot: { x: 81, y: 79 } },
        ],
        outputs: [{ kind: "item", id: "result", amount: 1, neiSlot: { x: 71, y: 8 } }],
        nei: {
          slots: [
            { side: "input", kind: "item", slotIndex: 0, x: 51, y: 30 },
            { side: "input", kind: "aspect", slotIndex: 0, x: 61, y: 79 },
            { side: "input", kind: "aspect", slotIndex: 1, x: 81, y: 79 },
            { side: "output", kind: "item", slotIndex: 0, x: 71, y: 8 },
          ],
          progressBars: [],
        },
      }),
    );

    expect(layout.id).toBe("thaumcraft-crucible");
    expect(layout.canvas).toMatchObject({ width: 170, height: 140 });
    expect(
      layout.slots.map((slot) => [slot.kind, slot.side, slot.resource.id, slot.x, slot.y]),
    ).toEqual([
      ["item", "input", "catalyst", 51, 30],
      ["aspect", "input", "thaumcraft:aspect:aer", 61, 79],
      ["aspect", "input", "thaumcraft:aspect:ordo", 81, 79],
      ["item", "output", "result", 71, 8],
    ]);
    expect(layout.progressBars).toEqual([]);
  });

  it("uses Thaumcraft arcane crafting NEI plugin positions", () => {
    const layout = getNeiRecipeLayout(
      recipe({
        machineType: "Thaumcraft Arcane Crafting",
        sourceRecipeMap: "Thaumcraft Arcane Crafting",
        inputs: [
          { kind: "item", id: "top-left", amount: 1, neiSlot: { x: 48, y: 33 } },
          { kind: "item", id: "center", amount: 1, neiSlot: { x: 76, y: 60 } },
          { kind: "aspect", id: "thaumcraft:aspect:aer", amount: 1, neiSlot: { x: 74, y: 115 } },
        ],
        outputs: [{ kind: "item", id: "crafted", amount: 1, neiSlot: { x: 74, y: 2 } }],
        nei: {
          slots: [
            { side: "input", kind: "item", slotIndex: 0, x: 48, y: 33 },
            { side: "input", kind: "item", slotIndex: 1, x: 76, y: 60 },
            { side: "input", kind: "aspect", slotIndex: 0, x: 74, y: 115 },
            { side: "output", kind: "item", slotIndex: 0, x: 74, y: 2 },
          ],
          progressBars: [],
        },
      }),
    );

    expect(layout.id).toBe("thaumcraft-arcane");
    expect(layout.canvas).toMatchObject({ width: 170, height: 174 });
    expect(layout.decorations).toHaveLength(3);
    expect(
      layout.slots.map((slot) => [slot.kind, slot.side, slot.resource.id, slot.x, slot.y]),
    ).toEqual([
      ["item", "input", "top-left", 48, 33],
      ["item", "input", "center", 76, 60],
      ["aspect", "input", "thaumcraft:aspect:aer", 74, 115],
      ["item", "output", "crafted", 74, 2],
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
