// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Recipe } from "@/lib/model/types";
import type { DatasetManifest, DatasetVersion, RecipeSummary } from "@/lib/datasets/types";
import { PROJECT_SCHEMA_VERSION } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { RecipeBrowser } from "./RecipeBrowser";
import { queryRecipeDatasetRecipes } from "@/lib/datasets/browser-loader";

const datasetVersion: DatasetVersion = {
  id: "test-version",
  gtnhVersion: "test",
  channel: "daily",
  publishedAt: "2026-05-25T00:00:00.000Z",
  manifestPath: "manifest.json",
  recipeDatasetPath: "recipes.json",
  sourceInfo: {
    sourceId: "recex",
    generatedAt: "2026-05-25T00:00:00.000Z",
  },
};

const cokeOvenRecipe: Recipe = {
  id: "coke-oven-log",
  name: "Coke Oven: Charcoal",
  machineType: "Coke Oven",
  minimumTier: "MV",
  durationTicks: 256,
  eut: 96,
  inputs: [
    {
      kind: "item",
      id: "gregtech:gt.integrated_circuit@1",
      amount: 0,
      displayName: "Integrated Circuit",
      consumed: false,
      neiSlot: { x: 44, y: 35 },
    },
    {
      kind: "item",
      id: "oredict:logWood",
      amount: 16,
      displayName: "Ore Dictionary: logWood",
      iconPath: "/items/oak-log.png",
      tooltip: ["Ore Dictionary: logWood"],
      neiSlot: { x: 62, y: 35 },
    },
  ],
  outputs: [{ kind: "item", id: "minecraft:coal@1", amount: 20, displayName: "Charcoal" }],
};

const cokeOvenSummary: RecipeSummary = {
  ...cokeOvenRecipe,
  recipeMap: "Coke Oven",
  slots: [],
  inputs: [
    {
      kind: "item",
      id: "minecraft:log@1",
      amount: 16,
      displayName: "Spruce Log",
      iconPath: "/items/spruce-log.png",
      tooltip: ["Spruce Log"],
      neiSlot: { x: 62, y: 35 },
    },
  ],
};

const browserLoaderMock = vi.hoisted(() => {
  const fullRecipe = {
    id: "coke-oven-log",
    name: "Coke Oven: Charcoal",
    machineType: "Coke Oven",
    minimumTier: "MV",
    durationTicks: 256,
    eut: 96,
    inputs: [
      {
        kind: "item",
        id: "gregtech:gt.integrated_circuit@1",
        amount: 0,
        displayName: "Integrated Circuit",
        consumed: false,
        neiSlot: { x: 44, y: 35 },
      },
      {
        kind: "item",
        id: "oredict:logWood",
        amount: 16,
        displayName: "Ore Dictionary: logWood",
        iconPath: "/items/oak-log.png",
        tooltip: ["Ore Dictionary: logWood"],
        neiSlot: { x: 62, y: 35 },
      },
    ],
    outputs: [{ kind: "item", id: "minecraft:coal@1", amount: 20, displayName: "Charcoal" }],
  };

  return {
    getRecipeDatasetRecipe: vi.fn(async () => fullRecipe),
    queryRecipeDatasetRecipes: vi.fn(async (_manifestUrl, _version, query) => ({
      recipes: [
        {
          ...fullRecipe,
          recipeMap: "Coke Oven",
          slots: [],
          inputs:
            query.mode === "uses"
              ? [
                  {
                    kind: "item",
                    id: "minecraft:log@1",
                    amount: 16,
                    displayName: "Spruce Log",
                    iconPath: "/items/spruce-log.png",
                    tooltip: ["Spruce Log"],
                    neiSlot: { x: 62, y: 35 },
                  },
                ]
              : fullRecipe.inputs,
        },
      ],
      total: 1,
      recipeMaps: ["Coke Oven"],
      offset: 0,
      limit: 120,
      hasMore: false,
    })),
  };
});

vi.mock("@/lib/datasets/browser-loader", () => ({
  getRecipeDatasetRecipe: browserLoaderMock.getRecipeDatasetRecipe,
  queryRecipeDatasetRecipes: browserLoaderMock.queryRecipeDatasetRecipes,
  queryRecipeDatasetResources: vi.fn(async () => ({
    resources: [],
    total: 0,
    offset: 0,
    limit: 6,
    hasMore: false,
  })),
}));

describe("RecipeBrowser", () => {
  beforeEach(() => {
    class TestResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", TestResizeObserver);

    const manifest: DatasetManifest = {
      schemaVersion: 1,
      latestDailyVersion: datasetVersion.id,
      versions: [datasetVersion],
    };

    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "recipe-browser-test",
      name: "Recipe browser test",
      fuelProfiles: [],
      recipes: [],
      nodes: [],
      edges: [],
    });
    useFactoryStore.getState().setDatasetManifest(manifest, "/datasets/manifest.json");
    useFactoryStore.getState().browseResource(
      {
        kind: "item",
        id: "minecraft:log@1",
        displayName: "Spruce Log",
      },
      "uses",
    );
  });

  it("keeps the concrete Spruce Log context when adding a recipe from the recipe book", async () => {
    render(<RecipeBrowser />);

    await screen.findByText("Coke Oven");
    fireEvent.click(await screen.findByLabelText("Add recipe node"));

    await waitFor(() => {
      expect(queryRecipeDatasetRecipes).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ mode: "uses" }),
      );
      const node = useFactoryStore.getState().project.nodes[0];
      expect(node?.recipeInputOverrides?.["1"]).toEqual(
        expect.objectContaining({
          id: "minecraft:log@1",
          displayName: "Spruce Log",
          iconPath: "/items/spruce-log.png",
          tooltip: ["Spruce Log"],
          alternatives: undefined,
        }),
      );
    });
    expect(useFactoryStore.getState().project.recipes[0]?.inputs[1]).toEqual(
      expect.objectContaining({
        id: "oredict:logWood",
      }),
    );
  });
});
