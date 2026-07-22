import { describe, expect, it } from "vitest";
import { loadBiodieselDemoProject } from "@/examples";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type Recipe } from "@/lib/model/types";
import { parseDatasetManifestJson, parseRecipeDatasetJson } from "./dataset-json";
import {
  buildRecipeContentIndex,
  migrateProjectRecipeIds,
  parseFactoryProjectJson,
  recipeContentKey,
  serializeFactoryProject,
} from "./factory-json";

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

  it("carries the controller block id from the recipe source to the resolved machine", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "machine-block-test",
      name: "Machine block test",
      recipes: [
        {
          id: "r1",
          name: "Chemical Plant: Nitrobenzene",
          // localized recipe-map name; the controller block is "ExxonMobil Chemical Plant"
          machineType: "Chemical Plant",
          minimumTier: "MV",
          durationTicks: 100,
          eut: 30,
          inputs: [{ kind: "item", id: "minecraft:coal", amount: 1 }],
          outputs: [{ kind: "item", id: "minecraft:dye", amount: 1 }],
          source: {
            datasetVersionId: "stable-2.8.4",
            recipeMap: "Chemical Plant",
            machineBlock: {
              id: "gregtech:gt.blockmachines@998",
              displayName: "ExxonMobil Chemical Plant",
            },
          },
        },
      ],
      nodes: [
        {
          id: "n1",
          recipeId: "r1",
          machineCount: 1,
          parallel: 1,
          overclockTier: "MV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      fuelProfiles: [],
    };

    // the resolved machine carries the exact controller-block join key, not just the localized name
    const exported = JSON.parse(serializeFactoryProject(project));
    expect(exported.resolved.machines[0].machineKey).toBe("Chemical Plant");
    expect(exported.resolved.machines[0].machineBlock).toEqual({
      id: "gregtech:gt.blockmachines@998",
      displayName: "ExxonMobil Chemical Plant",
    });

    // and it survives the public-schema round-trip on the recipe itself
    const reparsed = parseFactoryProjectJson(serializeFactoryProject(project));
    expect(reparsed.recipes[0].source?.machineBlock).toEqual({
      id: "gregtech:gt.blockmachines@998",
      displayName: "ExxonMobil Chemical Plant",
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

describe("recipe id migration by content", () => {
  const nitrobenzene = (id: string, overrides: Partial<Recipe> = {}): Recipe => ({
    id,
    name: "Chemical Plant: Nitrobenzene",
    machineType: "Chemical Plant",
    minimumTier: "HV",
    durationTicks: 600,
    eut: 480,
    inputs: [
      { kind: "fluid", id: "benzene", amount: 5000 },
      { kind: "fluid", id: "nitricacid", amount: 5000 },
      { kind: "fluid", id: "sulfuricacid", amount: 1000 },
    ],
    outputs: [{ kind: "fluid", id: "nitrobenzene", amount: 5000 }],
    source: { datasetVersionId: "stable-2.8.4", recipeMap: "Chemical Plant" },
    ...overrides,
  });

  const planWith = (recipes: Recipe[]): FactoryProject => ({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "migration-test",
    name: "Migration test",
    recipes,
    nodes: recipes.map((recipe, index) => ({
      id: `n${index + 1}`,
      recipeId: recipe.id,
      machineCount: 1,
      parallel: 1,
      overclockTier: "HV",
      enabled: true,
      position: { x: 0, y: 0 },
    })),
    edges: [],
    fuelProfiles: [],
  });

  it("keys a recipe on behaviour, not on slot order or display metadata", () => {
    const plain = nitrobenzene("a");
    const reordered = nitrobenzene("b", {
      name: "Totally different label",
      inputs: [
        {
          kind: "fluid",
          id: "sulfuricacid",
          amount: 1000,
          displayName: "Sulfuric Acid",
          iconPath: "/some/icon.png",
        },
        { kind: "fluid", id: "nitricacid", amount: 5000 },
        { kind: "fluid", id: "benzene", amount: 5000 },
      ],
    });

    expect(recipeContentKey(reordered)).toBe(recipeContentKey(plain));
    // amounts still matter, so a different ratio is a different recipe
    expect(
      recipeContentKey(
        nitrobenzene("c", { inputs: [{ kind: "fluid", id: "benzene", amount: 1 }] }),
      ),
    ).not.toBe(recipeContentKey(plain));
    // and so does output chance
    expect(
      recipeContentKey(
        nitrobenzene("d", {
          outputs: [{ kind: "fluid", id: "nitrobenzene", amount: 5000, chance: 0.5 }],
        }),
      ),
    ).not.toBe(recipeContentKey(plain));
  });

  it("leaves a plan alone when its recipe ids still exist in the dataset", () => {
    const project = planWith([nitrobenzene("oracle:stable-2.8.4:chemplant:abc123")]);
    const result = migrateProjectRecipeIds(project, [
      // same id, and a decoy sharing the content key: the exact id must win outright
      nitrobenzene("oracle:stable-2.8.4:chemplant:abc123"),
      nitrobenzene("oracle:stable-2.8.4:chemplant:decoy0"),
    ]);

    expect(result.changed).toBe(false);
    expect(result.project).toBe(project);
    expect(result.migrated).toEqual([]);
    expect(result.ambiguous).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });

  it("re-points a plan at the regenerated dataset when only the id hashes moved", () => {
    const project = planWith([nitrobenzene("oracle:stable-2.8.4:chemplant:oldhash")]);
    const result = migrateProjectRecipeIds(project, [
      nitrobenzene("oracle:stable-2.8.4:chemplant:newhash"),
      // an unrelated dataset recipe must not be considered
      nitrobenzene("oracle:stable-2.8.4:lcr:other", {
        durationTicks: 240,
        source: { recipeMap: "Large Chemical Reactor" },
      }),
    ]);

    expect(result.changed).toBe(true);
    expect(result.migrated).toEqual([
      {
        fromId: "oracle:stable-2.8.4:chemplant:oldhash",
        toId: "oracle:stable-2.8.4:chemplant:newhash",
        name: "Chemical Plant: Nitrobenzene",
      },
    ]);
    expect(result.unmatched).toEqual([]);
    expect(result.ambiguous).toEqual([]);

    // both the recipe and the node that references it move together
    expect(result.project.recipes[0]?.id).toBe("oracle:stable-2.8.4:chemplant:newhash");
    expect(result.project.nodes[0]?.recipeId).toBe("oracle:stable-2.8.4:chemplant:newhash");
    // and the original project is not mutated
    expect(project.recipes[0]?.id).toBe("oracle:stable-2.8.4:chemplant:oldhash");
    expect(project.nodes[0]?.recipeId).toBe("oracle:stable-2.8.4:chemplant:oldhash");
  });

  it("keeps the embedded recipe when the dataset has no counterpart", () => {
    const project = planWith([nitrobenzene("oracle:stable-2.8.4:chemplant:removed")]);
    const result = migrateProjectRecipeIds(project, [
      nitrobenzene("oracle:stable-2.8.4:chemplant:other", { durationTicks: 300 }),
    ]);

    expect(result.changed).toBe(false);
    expect(result.unmatched).toEqual([
      { id: "oracle:stable-2.8.4:chemplant:removed", name: "Chemical Plant: Nitrobenzene" },
    ]);
    // the plan still carries a usable recipe, so it opens and solves
    expect(result.project.recipes[0]?.id).toBe("oracle:stable-2.8.4:chemplant:removed");
    expect(result.project.recipes[0]?.outputs[0]?.id).toBe("nitrobenzene");
    expect(result.project.nodes[0]?.recipeId).toBe("oracle:stable-2.8.4:chemplant:removed");
  });

  it("reports ambiguity instead of picking one of several identical dataset recipes", () => {
    const project = planWith([nitrobenzene("oracle:stable-2.8.4:chemplant:oldhash")]);
    const result = migrateProjectRecipeIds(project, [
      nitrobenzene("oracle:stable-2.8.4:chemplant:twin1"),
      nitrobenzene("oracle:stable-2.8.4:chemplant:twin2"),
    ]);

    expect(result.changed).toBe(false);
    expect(result.migrated).toEqual([]);
    expect(result.ambiguous).toEqual([
      {
        id: "oracle:stable-2.8.4:chemplant:oldhash",
        name: "Chemical Plant: Nitrobenzene",
        candidateIds: [
          "oracle:stable-2.8.4:chemplant:twin1",
          "oracle:stable-2.8.4:chemplant:twin2",
        ],
      },
    ]);
    expect(result.project.nodes[0]?.recipeId).toBe("oracle:stable-2.8.4:chemplant:oldhash");
  });

  it("refuses to collapse two plan recipes that share one dataset counterpart", () => {
    const project = planWith([nitrobenzene("plan:one"), nitrobenzene("plan:two")]);
    const result = migrateProjectRecipeIds(project, [nitrobenzene("dataset:only")]);

    expect(result.changed).toBe(false);
    expect(result.ambiguous.map((entry) => entry.id)).toEqual(["plan:one", "plan:two"]);
    expect(result.project.nodes.map((node) => node.recipeId)).toEqual(["plan:one", "plan:two"]);
  });

  it("migrates only the stale references in a partly stale plan", () => {
    const project = planWith([
      nitrobenzene("dataset:fresh"),
      nitrobenzene("plan:stale", { durationTicks: 240, source: { recipeMap: "Chemical Plant" } }),
      nitrobenzene("plan:gone", { durationTicks: 999 }),
    ]);
    const result = migrateProjectRecipeIds(project, [
      nitrobenzene("dataset:fresh"),
      nitrobenzene("dataset:renamed", {
        durationTicks: 240,
        source: { recipeMap: "Chemical Plant" },
      }),
    ]);

    expect(result.migrated).toEqual([
      { fromId: "plan:stale", toId: "dataset:renamed", name: "Chemical Plant: Nitrobenzene" },
    ]);
    expect(result.unmatched.map((entry) => entry.id)).toEqual(["plan:gone"]);
    expect(result.project.nodes.map((node) => node.recipeId)).toEqual([
      "dataset:fresh",
      "dataset:renamed",
      "plan:gone",
    ]);
  });

  it("accepts a prebuilt content index so a large dataset is walked once", () => {
    const index = buildRecipeContentIndex([nitrobenzene("dataset:newhash")]);
    expect(index.size).toBe(1);

    const result = migrateProjectRecipeIds(planWith([nitrobenzene("plan:oldhash")]), index);
    expect(result.project.nodes[0]?.recipeId).toBe("dataset:newhash");
  });

  it("survives a round-trip through the public plan schema", () => {
    const project = planWith([nitrobenzene("plan:oldhash")]);
    const migrated = migrateProjectRecipeIds(project, [nitrobenzene("dataset:newhash")]).project;
    const reparsed = parseFactoryProjectJson(serializeFactoryProject(migrated));

    expect(reparsed.recipes[0]?.id).toBe("dataset:newhash");
    expect(reparsed.nodes[0]?.recipeId).toBe("dataset:newhash");
  });
});
