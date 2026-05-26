import { describe, expect, it } from "vitest";
import { enrichDatasetRecipes } from "./enrich";
import type { RecipeDataset } from "./types";

describe("enrichDatasetRecipes", () => {
  it("copies dataset resource icons into recipe amounts without changing amounts", () => {
    const dataset: RecipeDataset = {
      schemaVersion: 1,
      datasetVersionId: "test",
      gtnhVersion: "test",
      sourceInfo: { sourceId: "recex", generatedAt: "2026-01-01T00:00:00.000Z" },
      resources: [
        {
          id: "gregtech:gt.metaitem.01@1",
          kind: "item",
          displayName: "Test Dust",
          iconPath: "/datasets/gtnh/test/textures/rendered/test-dust.png",
        },
      ],
      recipes: [
        {
          id: "recipe",
          name: "Recipe",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 8,
          inputs: [{ kind: "item", id: "gregtech:gt.metaitem.01@1", amount: 2 }],
          outputs: [{ kind: "item", id: "minecraft:stone", amount: 1 }],
        },
      ],
      oreDictionary: {},
      recipeMaps: ["Assembler"],
      generatedAt: "2026-01-01T00:00:00.000Z",
    };

    const enriched = enrichDatasetRecipes(dataset);

    expect(enriched.recipes[0]?.inputs[0]).toMatchObject({
      amount: 2,
      displayName: "Test Dust",
      iconPath: "/datasets/gtnh/test/textures/rendered/test-dust.png",
    });
  });

  it("adds shared recipe map slot capacities to recipes with partial outputs", () => {
    const dataset = baseDataset([
      {
        id: "partial-electrolyzer",
        name: "Partial Electrolyzer",
        machineType: "Electrolyzer",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 8,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [
          { kind: "item", id: "a", amount: 1 },
          { kind: "item", id: "b", amount: 1 },
          { kind: "item", id: "c", amount: 1 },
        ],
        source: { recipeMap: "Electrolyzer" },
      },
      {
        id: "full-electrolyzer",
        name: "Full Electrolyzer",
        machineType: "Electrolyzer",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 8,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [
          { kind: "item", id: "a", amount: 1 },
          { kind: "item", id: "b", amount: 1 },
          { kind: "item", id: "c", amount: 1 },
          { kind: "item", id: "d", amount: 1 },
          { kind: "item", id: "e", amount: 1 },
          { kind: "item", id: "f", amount: 1 },
        ],
        source: { recipeMap: "Electrolyzer" },
      },
    ]);

    const enriched = enrichDatasetRecipes(dataset);

    expect(enriched.recipes[0]?.nei?.slotCapacity).toMatchObject({
      maxItemOutputs: 6,
    });
  });

  it("applies known recipe map slot capacity overrides to exported name variants", () => {
    const dataset = baseDataset([
      {
        id: "partial-multiblock-electrolyzer",
        name: "Partial Multiblock Electrolyzer",
        machineType: "Multiblock Electrolyzer",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 8,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [
          { kind: "item", id: "a", amount: 1 },
          { kind: "item", id: "b", amount: 1 },
        ],
        source: { recipeMap: "multiblock electrolyzer recipes" },
      },
      {
        id: "partial-chemical-plant",
        name: "Partial Chemical Plant",
        machineType: "Chemical Plant",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 8,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [{ kind: "fluid", id: "acid", amount: 1000 }],
        source: { recipeMap: "chemical plant recipe map" },
      },
    ]);

    const enriched = enrichDatasetRecipes(dataset);

    expect(enriched.recipes[0]?.nei?.slotCapacity).toMatchObject({
      maxItemOutputs: 6,
      maxFluidInputs: 6,
      maxFluidOutputs: 6,
    });
    expect(enriched.recipes[1]?.nei?.slotCapacity).toMatchObject({
      maxItemInputs: 4,
      maxItemOutputs: 6,
      maxFluidInputs: 4,
      maxFluidOutputs: 3,
    });
  });

  it("keeps shared single-block recipe maps grouped for machine handler selection", () => {
    const dataset = baseDataset([
      {
        id: "single-mixer",
        name: "Mixer: Product",
        machineType: "Mixer",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 8,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [{ kind: "item", id: "product", amount: 1 }],
        source: { recipeMap: "Mixer" },
      },
    ]);

    const enriched = enrichDatasetRecipes(dataset);

    expect(enriched.recipes).toHaveLength(1);
    expect(enriched.recipes[0]).toMatchObject({
      machineType: "Mixer",
      source: { recipeMap: "Mixer" },
    });
  });

  it("does not add heating coils as fake NEI inputs", () => {
    const dataset = baseDataset([
      {
        id: "ebf",
        name: "Blast Furnace: Hot Ingot",
        machineType: "Blast Furnace",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 120,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [{ kind: "item", id: "hot_ingot", amount: 1 }],
        source: { recipeMap: "Blast Furnace" },
        nei: { additionalInfo: ["Special value: 2700"] },
      },
    ]);

    const enriched = enrichDatasetRecipes(dataset);

    expect(enriched.recipes[0]?.inputs).toHaveLength(1);
  });

  it("adds first-pass IC2 crop production controls without manual harvest", () => {
    const dataset = baseDataset([
      {
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
      },
    ]);

    const recipe = enrichDatasetRecipes(dataset).recipes[0];
    const statControl = recipe?.machineConfigControls?.find(
      (control) => control.id === "cropStats",
    );

    expect(recipe).toMatchObject({
      machineType: "Crop Manager",
      minimumTier: "LV",
      eut: 8,
    });
    expect(recipe?.machineHandlers?.map((handler) => handler.label)).not.toContain("Manual");
    expect(recipe?.machineHandlers?.map((handler) => handler.label)).toContain(
      "Forestry Multifarm",
    );
    expect(statControl?.defaultKey).toBe("23-31-0");
    expect(statControl?.tiers.map((tier) => tier.label)).toEqual(["1/1/1", "23/31/0"]);
  });
});

function baseDataset(recipes: RecipeDataset["recipes"]): RecipeDataset {
  return {
    schemaVersion: 1,
    datasetVersionId: "test",
    gtnhVersion: "test",
    sourceInfo: { sourceId: "recex", generatedAt: "2026-01-01T00:00:00.000Z" },
    resources: [],
    recipes,
    oreDictionary: {},
    recipeMaps: [
      ...new Set(recipes.map((recipe) => recipe.source?.recipeMap ?? recipe.machineType)),
    ],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };
}
