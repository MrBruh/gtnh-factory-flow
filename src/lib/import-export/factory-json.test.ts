import { describe, expect, it } from "vitest";
import { loadBiodieselDemoProject } from "@/examples";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { parseDatasetManifestJson, parseRecipeDatasetJson } from "./dataset-json";
import { parseFactoryProjectJson, serializeFactoryProject } from "./factory-json";

describe("factory JSON import/export", () => {
  it("round-trips the biodiesel demo through the public schema", () => {
    const project = loadBiodieselDemoProject();
    const json = serializeFactoryProject(project);
    const parsed = parseFactoryProjectJson(json);

    expect(parsed.name).toBe(project.name);
    expect(parsed.recipes).toHaveLength(7);
    expect(parsed.nodes).toHaveLength(7);
    expect(parsed.metadata?.isDemo).toBe(true);
  });

  it("adds a resolved throughput block and provenance to the v2 export", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "resolved-test",
      name: "Resolved test",
      recipes: [
        {
          id: "r1",
          name: "Forge Hammer: Sand",
          machineType: "Forge Hammer",
          minimumTier: "LV",
          durationTicks: 10,
          eut: 16,
          inputs: [{ kind: "item", id: "minecraft:gravel", amount: 1 }],
          outputs: [{ kind: "item", id: "minecraft:sand", amount: 1 }],
          source: { datasetVersionId: "stable-2.8.4", recipeMap: "Forge Hammer" },
        },
      ],
      nodes: [
        {
          id: "n1",
          recipeId: "r1",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      fuelProfiles: [],
    };

    const exported = JSON.parse(
      serializeFactoryProject(project, { exportedAt: "2026-06-28T00:00:00.000Z" }),
    );

    expect(exported.schemaVersion).toBe(2);
    expect(exported.datasetVersionId).toBe("stable-2.8.4");
    expect(exported.app).toMatchObject({
      name: "gtnh-factory-flow",
      exportedAt: "2026-06-28T00:00:00.000Z",
    });

    expect(exported.resolved.machines).toHaveLength(1);
    expect(exported.resolved.machines[0]).toMatchObject({
      nodeId: "n1",
      machineKey: "Forge Hammer",
      machineType: "Forge Hammer",
      tier: "LV",
      machineCount: 1,
      totalEut: 16,
    });
    expect(exported.resolved.machines[0].outputs).toContainEqual({
      kind: "item",
      id: "minecraft:sand",
      perSecond: 2,
    });
    expect(exported.resolved.machines[0].inputs).toContainEqual({
      kind: "item",
      id: "minecraft:gravel",
      perSecond: 2,
    });
    expect(exported.resolved.power).toMatchObject({ totalEut: 16, totalEuPerSecond: 320 });
    expect(exported.resolved.externalIO.outputs).toContainEqual({
      kind: "item",
      id: "minecraft:sand",
      perSecond: 2,
    });
    expect(exported.resolved.externalIO.inputs).toContainEqual({
      kind: "item",
      id: "minecraft:gravel",
      perSecond: 2,
    });
  });

  it("strips export-only fields on import so the model stays canonical", () => {
    const json = serializeFactoryProject(loadBiodieselDemoProject());
    expect(JSON.parse(json).resolved).toBeDefined();

    const reimported = parseFactoryProjectJson(json) as unknown as Record<string, unknown>;
    expect(reimported.resolved).toBeUndefined();
    expect(reimported.app).toBeUndefined();
    expect(reimported.datasetVersionId).toBeUndefined();
  });

  it("migrates a v1 plan to the current schema version on import", () => {
    const project = parseFactoryProjectJson(
      JSON.stringify({
        schemaVersion: 1,
        id: "legacy",
        name: "Legacy plan",
        recipes: [],
        nodes: [],
        edges: [],
        fuelProfiles: [],
      }),
    );

    expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it("reports invalid JSON and invalid factory data", () => {
    expect(() => parseFactoryProjectJson("{")).toThrow(/Invalid JSON/);
    expect(() =>
      parseFactoryProjectJson(
        JSON.stringify({
          schemaVersion: 1,
          id: "bad",
          name: "",
          recipes: [],
          nodes: [],
          edges: [],
          fuelProfiles: [],
        }),
      ),
    ).toThrow(/Invalid factory project/);
  });

  it("normalizes hidden fractional recipe parallelism to one operation", () => {
    const project = parseFactoryProjectJson(
      JSON.stringify({
        schemaVersion: 1,
        id: "fractional-parallel",
        name: "Fractional parallel",
        recipes: [],
        nodes: [
          {
            id: "node-1",
            recipeId: "recipe-1",
            machineCount: 1,
            parallel: 0.01,
            overclockTier: "HV",
            enabled: true,
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
        fuelProfiles: [],
      }),
    );

    expect(project.nodes[0]?.parallel).toBe(1);
  });

  it("accepts zero output machine config tiers for disabled production states", () => {
    const project = parseFactoryProjectJson(
      JSON.stringify({
        schemaVersion: 1,
        id: "zero-output-control",
        name: "Zero output control",
        recipes: [
          {
            id: "bee-recipe",
            name: "Bee Produce: Test Bee",
            machineType: "Apiary",
            minimumTier: "NONE",
            durationTicks: 550,
            eut: 0,
            inputs: [{ kind: "item", id: "factoryflow:bee_species:test", amount: 1 }],
            outputs: [{ kind: "item", id: "test:comb", amount: 1 }],
            machineConfigControls: [
              {
                id: "beeEnvironment",
                label: "Climate",
                minimumKey: "wrong",
                defaultKey: "preferred",
                tiers: [
                  {
                    key: "wrong",
                    label: "Wrong",
                    outputMultiplier: 0,
                    resource: {
                      kind: "item",
                      id: "factoryflow:bee_environment_wrong",
                      amount: 1,
                    },
                  },
                ],
              },
            ],
          },
        ],
        nodes: [],
        edges: [],
        fuelProfiles: [],
      }),
    );

    expect(project.recipes[0]?.machineConfigControls?.[0]?.tiers[0]?.outputMultiplier).toBe(0);
  });

  it("validates normalized recipe datasets", () => {
    const dataset = parseRecipeDatasetJson(
      JSON.stringify({
        schemaVersion: 1,
        datasetVersionId: "gtnh-test",
        gtnhVersion: "test",
        sourceInfo: {
          sourceId: "nesql",
          generatedAt: "2026-05-19T00:00:00.000Z",
        },
        resources: [
          {
            id: "item:gregtech:test",
            kind: "item",
            displayName: "Test Dust",
          },
        ],
        recipes: [
          {
            id: "recipe-test",
            name: "Test Dust",
            machineType: "Macerator",
            minimumTier: "LV",
            durationTicks: 200,
            eut: 30,
            inputs: [{ kind: "item", id: "ore:test", amount: 1 }],
            outputs: [{ kind: "item", id: "item:gregtech:test", amount: 2 }],
            source: {
              datasetVersionId: "gtnh-test",
              recipeMap: "macerator",
              exporter: "nesql",
            },
          },
        ],
        oreDictionary: {},
        recipeMaps: ["macerator"],
        generatedAt: "2026-05-19T00:00:00.000Z",
      }),
    );

    expect(dataset.sourceInfo.sourceId).toBe("nesql");
    expect(dataset.recipes[0]?.source?.recipeMap).toBe("macerator");
  });

  it("validates dataset manifests with version metadata", () => {
    const manifest = parseDatasetManifestJson(
      JSON.stringify({
        schemaVersion: 1,
        latestStableVersion: "gtnh-2.7.4",
        versions: [
          {
            id: "gtnh-2.7.4",
            gtnhVersion: "2.7.4",
            channel: "stable",
            publishedAt: "2026-05-19T00:00:00.000Z",
            manifestPath: "/datasets/gtnh/datasets.manifest.json",
            recipeDatasetPath: "/datasets/gtnh/2.7.4/recipes.json",
            sourceInfo: {
              sourceId: "nesql",
              generatedAt: "2026-05-19T00:00:00.000Z",
            },
          },
        ],
      }),
    );

    expect(manifest.latestStableVersion).toBe("gtnh-2.7.4");
    expect(manifest.versions[0]?.recipeDatasetPath).toBe("/datasets/gtnh/2.7.4/recipes.json");
  });
});
