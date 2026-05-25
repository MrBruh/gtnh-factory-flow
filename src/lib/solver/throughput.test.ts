import { describe, expect, it } from "vitest";
import { gtnhFuelProfiles } from "@/lib/model/fuels";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

describe("calculateThroughput", () => {
  it("uses the Minecraft 20 ticks/s throughput formulas", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "test-project",
      name: "Solver test",
      targetRate: {
        kind: "item",
        resourceId: "plate",
        amountPerSecond: 0.8,
      },
      recipes: [
        {
          id: "plate-recipe",
          name: "Plate recipe",
          machineType: "Bender",
          minimumTier: "LV",
          durationTicks: 600,
          eut: 30,
          inputs: [{ kind: "item", id: "ore", amount: 1 }],
          outputs: [{ kind: "item", id: "plate", amount: 2 }],
        },
      ],
      nodes: [
        {
          id: "node-plate",
          recipeId: "plate-recipe",
          machineCount: 3,
          parallel: 2,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      fuelProfiles: gtnhFuelProfiles,
      selectedFuelProfileId: "biodiesel",
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });
    const node = result.nodes["node-plate"];

    expect(node.operationRatePerSecond).toBeCloseTo(0.2);
    expect(node.outputs["item:plate"].amountPerSecond).toBeCloseTo(0.4);
    expect(node.inputs["item:ore"].amountPerSecond).toBeCloseTo(0.2);
    expect(node.euT).toBe(180);
    expect(result.totalEuT).toBe(180);
    expect(result.totalEuPerSecond).toBe(3600);
    expect(node.utilization).toBeCloseTo(2);
    expect(node.theoreticalMachinesRequired).toBeCloseTo(6);
    expect(result.externalInputs[0]?.resourceId).toBe("ore");
    expect(result.fuelEstimate?.fuelPerSecond).toBeCloseTo(0.28125);
  });

  it("derives edge demand from the target node consumption", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "edge-project",
      name: "Edge test",
      recipes: [
        {
          id: "water-source",
          name: "Water source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 200,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "fluid", id: "water", amount: 100 }],
        },
        {
          id: "water-consumer",
          name: "Water consumer",
          machineType: "Chemical Reactor",
          minimumTier: "LV",
          durationTicks: 100,
          eut: 30,
          inputs: [{ kind: "fluid", id: "water", amount: 50 }],
          outputs: [{ kind: "item", id: "dust", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "water-source",
          machineCount: 1,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "consumer",
          recipeId: "water-consumer",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          id: "water-edge",
          source: "source",
          target: "consumer",
          resourceKind: "fluid",
          resourceId: "water",
          label: "Water",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.edges["water-edge"].demandPerSecond).toBeCloseTo(10);
    expect(result.edges["water-edge"].transferredPerSecond).toBeCloseTo(10);
    expect(result.nodes.source.utilization).toBeCloseTo(1);
    expect(result.resources["fluid:water"].netPerSecond).toBeCloseTo(0);
  });

  it("scales edge labels from final target utilization", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "edge-utilization-project",
      name: "Edge utilization label test",
      targetRate: {
        kind: "item",
        resourceId: "dust",
        amountPerSecond: 0.25,
      },
      recipes: [
        {
          id: "source-recipe",
          name: "Powder source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "powder", amount: 10 }],
        },
        {
          id: "consumer-recipe",
          name: "Dust consumer",
          machineType: "Mixer",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "item", id: "powder", amount: 10 }],
          outputs: [{ kind: "item", id: "dust", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "source-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "consumer",
          recipeId: "consumer-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          id: "powder-edge",
          source: "source",
          target: "consumer",
          resourceKind: "item",
          resourceId: "powder",
          label: "Powder",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.consumer.utilization).toBeCloseTo(0.25);
    expect(result.edges["powder-edge"].demandPerSecond).toBeCloseTo(2.5);
    expect(result.edges["powder-edge"].transferredPerSecond).toBeCloseTo(2.5);
    expect(result.resources["item:powder"].producedPerSecond).toBeCloseTo(2.5);
    expect(result.resources["item:powder"].consumedPerSecond).toBeCloseTo(2.5);
    expect(result.resources["item:powder"].netPerSecond).toBeCloseTo(0);
  });

  it("uses concrete item edges to satisfy ore dictionary input demand", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "ore-dictionary-edge-project",
      name: "Ore dictionary edge test",
      recipes: [
        {
          id: "stick-source",
          name: "Stick source",
          machineType: "Source",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "minecraft:stick@0", amount: 1 }],
        },
        {
          id: "crafting",
          name: "Crafting",
          machineType: "Shaped Crafting",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 0,
          inputs: [
            {
              kind: "item",
              id: "oredict:stickWood",
              amount: 1,
              alternatives: [{ kind: "item", id: "minecraft:stick@0", displayName: "Stick" }],
            },
          ],
          outputs: [{ kind: "item", id: "crafted", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "stick-source",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "target",
          recipeId: "crafting",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          id: "stick-edge",
          source: "source",
          target: "target",
          resourceKind: "item",
          resourceId: "minecraft:stick@0",
          label: "Stick",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.edges["stick-edge"].demandPerSecond).toBeCloseTo(1);
    expect(result.edges["stick-edge"].transferredPerSecond).toBeCloseTo(1);
    expect(result.nodes.source.utilization).toBeCloseTo(1);
  });

  it("lets a drawer or tank absorb producer output even without consumers", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "storage-sink-project",
      name: "Storage sink test",
      recipes: [
        {
          id: "source-recipe",
          name: "Dust source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "dust", amount: 2 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "source-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      storages: [
        {
          id: "dust-drawer",
          kind: "item",
          resourceId: "dust",
          displayName: "Dust",
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          id: "drawer-edge",
          source: "source",
          target: "dust-drawer",
          resourceKind: "item",
          resourceId: "dust",
          label: "Dust",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.edges["drawer-edge"].transferredPerSecond).toBeCloseTo(2);
    expect(result.nodes.source.utilization).toBeCloseTo(1);
    expect(result.nodes.source.theoreticalMachinesRequired).toBeCloseTo(1);
    expect(result.storages["dust-drawer"].producedPerSecond).toBeCloseTo(2);
    expect(result.storages["dust-drawer"].consumedPerSecond).toBeCloseTo(0);
    expect(result.storages["dust-drawer"].netPerSecond).toBeCloseTo(2);
    expect(result.storages["dust-drawer"].status).toBe("filling");
  });

  it("updates storage link throughput from current machine capacity instead of stale edge rates", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "storage-sink-rate-project",
      name: "Storage sink rate test",
      recipes: [
        {
          id: "source-recipe",
          name: "Dust source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "dust", amount: 2 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "source-recipe",
          machineCount: 3,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      storages: [
        {
          id: "dust-drawer",
          kind: "item",
          resourceId: "dust",
          displayName: "Dust",
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          id: "drawer-edge",
          source: "source",
          target: "dust-drawer",
          resourceKind: "item",
          resourceId: "dust",
          label: "Dust",
          ratePerSecond: 0.03,
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.edges["drawer-edge"].demandPerSecond).toBeCloseTo(6);
    expect(result.edges["drawer-edge"].transferredPerSecond).toBeCloseTo(6);
    expect(result.storages["dust-drawer"].netPerSecond).toBeCloseTo(6);
  });

  it("routes full producer surplus through storage sinks", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "storage-effective-rate-project",
      name: "Storage effective rate test",
      targetRate: {
        kind: "item",
        resourceId: "plate",
        amountPerSecond: 1,
      },
      recipes: [
        {
          id: "source-recipe",
          name: "Dust source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "dust", amount: 10 }],
        },
        {
          id: "consumer-recipe",
          name: "Plate target",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "item", id: "dust", amount: 10 }],
          outputs: [{ kind: "item", id: "plate", amount: 10 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "source-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "consumer",
          recipeId: "consumer-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 300, y: 0 },
        },
      ],
      storages: [
        {
          id: "dust-drawer-out",
          kind: "item",
          resourceId: "dust",
          position: { x: 120, y: 0 },
        },
        {
          id: "dust-drawer-in",
          kind: "item",
          resourceId: "dust",
          position: { x: 180, y: 0 },
        },
      ],
      edges: [
        {
          id: "source-to-drawer",
          source: "source",
          target: "dust-drawer-out",
          resourceKind: "item",
          resourceId: "dust",
        },
        {
          id: "drawer-to-consumer",
          source: "dust-drawer-in",
          target: "consumer",
          resourceKind: "item",
          resourceId: "dust",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.consumer.utilization).toBeCloseTo(0.1);
    expect(result.nodes.source.utilization).toBeCloseTo(1);
    expect(result.edges["source-to-drawer"].demandPerSecond).toBeCloseTo(10);
    expect(result.edges["source-to-drawer"].transferredPerSecond).toBeCloseTo(10);
    expect(result.storages["dust-drawer-out"].producedPerSecond).toBeCloseTo(10);
    expect(result.storages["dust-drawer-out"].consumedPerSecond).toBeCloseTo(1);
    expect(result.storages["dust-drawer-out"].netPerSecond).toBeCloseTo(9);
    expect(result.resources["item:dust"].netPerSecond).toBeCloseTo(9);
  });

  it("sends only remaining producer capacity to storage when consumers are directly connected", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "storage-direct-surplus-project",
      name: "Storage direct surplus test",
      recipes: [
        {
          id: "source-recipe",
          name: "Dust source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "dust", amount: 10 }],
        },
        {
          id: "consumer-recipe",
          name: "Dust consumer",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "item", id: "dust", amount: 2 }],
          outputs: [{ kind: "item", id: "plate", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "source-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "consumer",
          recipeId: "consumer-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 300, y: 0 },
        },
      ],
      storages: [
        {
          id: "dust-drawer",
          kind: "item",
          resourceId: "dust",
          position: { x: 160, y: 0 },
        },
      ],
      edges: [
        {
          id: "source-to-consumer",
          source: "source",
          target: "consumer",
          resourceKind: "item",
          resourceId: "dust",
        },
        {
          id: "source-to-drawer",
          source: "source",
          target: "dust-drawer",
          resourceKind: "item",
          resourceId: "dust",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.source.utilization).toBeCloseTo(1);
    expect(result.edges["source-to-consumer"].transferredPerSecond).toBeCloseTo(2);
    expect(result.edges["source-to-drawer"].transferredPerSecond).toBeCloseTo(8);
    expect(result.storages["dust-drawer"].netPerSecond).toBeCloseTo(8);
  });

  it("does not add global target demand on top of output fully routed to storage", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "storage-target-project",
      name: "Storage target test",
      targetRate: {
        kind: "item",
        resourceId: "dust",
        amountPerSecond: 10,
      },
      recipes: [
        {
          id: "source-recipe",
          name: "Dust source",
          machineType: "Source Hatch",
          minimumTier: "DEMO",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "dust", amount: 2 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "source-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "DEMO",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      storages: [
        {
          id: "dust-drawer",
          kind: "item",
          resourceId: "dust",
          displayName: "Dust",
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          id: "drawer-edge",
          source: "source",
          target: "dust-drawer",
          resourceKind: "item",
          resourceId: "dust",
          label: "Dust",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.source.utilization).toBeCloseTo(1);
    expect(result.nodes.source.theoreticalMachinesRequired).toBeCloseTo(1);
    expect(result.nodes.source.requiredRatePerSecond).toBeCloseTo(2);
    expect(result.nodes.source.maxRatePerSecond).toBeCloseTo(2);
  });

  it("lets a drawer or tank feed consumers and show negative net when undersupplied", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "storage-source-project",
      name: "Storage source test",
      recipes: [
        {
          id: "consumer-recipe",
          name: "Dust consumer",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "item", id: "dust", amount: 3 }],
          outputs: [{ kind: "item", id: "plate", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "consumer",
          recipeId: "consumer-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 200, y: 0 },
        },
      ],
      storages: [
        {
          id: "dust-drawer",
          kind: "item",
          resourceId: "dust",
          displayName: "Dust",
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          id: "drawer-edge",
          source: "dust-drawer",
          target: "consumer",
          resourceKind: "item",
          resourceId: "dust",
          label: "Dust",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.edges["drawer-edge"].demandPerSecond).toBeCloseTo(3);
    expect(result.edges["drawer-edge"].transferredPerSecond).toBeCloseTo(3);
    expect(result.storages["dust-drawer"].producedPerSecond).toBeCloseTo(0);
    expect(result.storages["dust-drawer"].consumedPerSecond).toBeCloseTo(3);
    expect(result.storages["dust-drawer"].netPerSecond).toBeCloseTo(-3);
    expect(result.storages["dust-drawer"].status).toBe("draining");
  });

  it("aggregates drawer and tank throughput by referenced resource", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "storage-reference-project",
      name: "Storage reference aggregation test",
      recipes: [
        {
          id: "source-recipe",
          name: "Dust source",
          machineType: "Macerator",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [],
          outputs: [{ kind: "item", id: "dust", amount: 5 }],
        },
        {
          id: "consumer-recipe",
          name: "Dust consumer",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "item", id: "dust", amount: 2 }],
          outputs: [{ kind: "item", id: "plate", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "source",
          recipeId: "source-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "consumer",
          recipeId: "consumer-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 400, y: 0 },
        },
      ],
      storages: [
        {
          id: "dust-drawer-a",
          kind: "item",
          resourceId: "dust",
          displayName: "Dust",
          position: { x: 160, y: 0 },
        },
        {
          id: "dust-drawer-b",
          kind: "item",
          resourceId: "dust",
          displayName: "Dust",
          position: { x: 260, y: 0 },
        },
      ],
      edges: [
        {
          id: "source-to-drawer",
          source: "source",
          target: "dust-drawer-a",
          resourceKind: "item",
          resourceId: "dust",
          label: "Dust",
        },
        {
          id: "drawer-to-consumer",
          source: "dust-drawer-b",
          target: "consumer",
          resourceKind: "item",
          resourceId: "dust",
          label: "Dust",
        },
      ],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    for (const storageId of ["dust-drawer-a", "dust-drawer-b"]) {
      expect(result.storages[storageId].producedPerSecond).toBeCloseTo(5);
      expect(result.storages[storageId].consumedPerSecond).toBeCloseTo(2);
      expect(result.storages[storageId].netPerSecond).toBeCloseTo(3);
      expect(result.storages[storageId].status).toBe("filling");
    }
  });

  it("does not consume non-consumed recipe inputs", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "non-consumed-project",
      name: "Non-consumed input test",
      recipes: [
        {
          id: "catalyst-recipe",
          name: "Catalyst recipe",
          machineType: "Chemical Reactor",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [
            { kind: "item", id: "catalyst", amount: 1, consumed: false },
            { kind: "item", id: "dust", amount: 2 },
          ],
          outputs: [{ kind: "item", id: "product", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "node",
          recipeId: "catalyst-recipe",
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

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.node.inputs["item:catalyst"]).toBeUndefined();
    expect(result.resources["item:catalyst"]).toBeUndefined();
    expect(result.resources["item:dust"].consumedPerSecond).toBeCloseTo(2);
  });

  it("applies output chance to production and capacity", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "chance-output-project",
      name: "Chance output test",
      targetRate: {
        kind: "item",
        resourceId: "tiny_dust",
        amountPerSecond: 0.25,
      },
      recipes: [
        {
          id: "chance-recipe",
          name: "Chance recipe",
          machineType: "Ore Washer",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "item", id: "ore", amount: 1 }],
          outputs: [{ kind: "item", id: "tiny_dust", amount: 1, chance: 0.25 }],
        },
      ],
      nodes: [
        {
          id: "node",
          recipeId: "chance-recipe",
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

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.node.outputs["item:tiny_dust"].amountPerSecond).toBeCloseTo(0.25);
    expect(result.resources["item:tiny_dust"].producedPerSecond).toBeCloseTo(0.25);
    expect(result.nodes.node.maxRatePerSecond).toBeCloseTo(0.25);
    expect(result.nodes.node.utilization).toBeCloseTo(1);
  });

  it("applies voltage tier overclocks to speed and EU/t", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "overclock-project",
      name: "Overclock test",
      recipes: [
        {
          id: "dust-recipe",
          name: "Dust recipe",
          machineType: "Macerator",
          minimumTier: "LV",
          durationTicks: 80,
          eut: 30,
          inputs: [{ kind: "item", id: "ore", amount: 1 }],
          outputs: [{ kind: "item", id: "dust", amount: 2 }],
        },
      ],
      nodes: [
        {
          id: "node",
          recipeId: "dust-recipe",
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

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.node.operationRatePerSecond).toBeCloseTo(0.5);
    expect(result.nodes.node.outputs["item:dust"].amountPerSecond).toBeCloseTo(1);
    expect(result.nodes.node.inputs["item:ore"].amountPerSecond).toBeCloseTo(0.5);
    expect(result.nodes.node.euT).toBe(120);
    expect(result.totalEuT).toBe(120);
  });

  it("applies Tree Growth Simulator tier and tool output formulas without changing work time", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "tgs-project",
      name: "TGS formula test",
      recipes: [
        {
          id: "tgs-oak",
          name: "Tree Growth Simulator: Oak Log",
          machineType: "Tree Growth Simulator",
          minimumTier: "UNKNOWN",
          durationTicks: 100,
          eut: 0,
          inputs: [{ kind: "item", id: "minecraft:sapling", amount: 1, consumed: false }],
          outputs: [
            {
              kind: "item",
              id: "minecraft:log",
              amount: 5,
              neiSlot: { x: 108, y: 36 },
            },
            {
              kind: "item",
              id: "minecraft:sapling",
              amount: 5,
              neiSlot: { x: 126, y: 36 },
            },
          ],
          machineConfigControls: [
            {
              id: "tgsToolSlot1",
              label: "Tool Slot 1",
              minimumKey: "none",
              defaultKey: "none",
              tiers: [
                {
                  key: "none",
                  label: "-",
                  resource: { kind: "item", id: "empty", amount: 1 },
                },
                {
                  key: "log:saw",
                  label: "Saw",
                  outputMultiplier: 1,
                  resource: { kind: "item", id: "saw", amount: 1 },
                },
                {
                  key: "log:chainsaw",
                  label: "Chainsaw",
                  outputMultiplier: 4,
                  resource: { kind: "item", id: "chainsaw", amount: 1 },
                },
              ],
            },
            {
              id: "tgsToolSlot2",
              label: "Tool Slot 2",
              minimumKey: "none",
              defaultKey: "none",
              tiers: [
                {
                  key: "none",
                  label: "-",
                  resource: { kind: "item", id: "empty", amount: 1 },
                },
                {
                  key: "log:chainsaw",
                  label: "Chainsaw",
                  outputMultiplier: 4,
                  resource: { kind: "item", id: "chainsaw", amount: 1 },
                },
              ],
            },
          ],
          source: { recipeMap: "Tree Growth Simulator" },
        },
      ],
      nodes: [
        {
          id: "node",
          recipeId: "tgs-oak",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          machineConfigTiers: { tgsToolSlot1: "log:chainsaw" },
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.node.operationRatePerSecond).toBeCloseTo(0.2);
    expect(result.nodes.node.outputs["item:minecraft:log"].amountPerSecond).toBeCloseTo(7.2);
    expect(result.nodes.node.outputs["item:minecraft:sapling"].amountPerSecond).toBeCloseTo(1.8);
    expect(result.nodes.node.euT).toBe(0);
  });

  it("uses the first matching Tree Growth Simulator tool per output mode", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "tgs-tool-order-project",
      name: "TGS tool order test",
      recipes: [
        {
          id: "tgs-oak",
          name: "Tree Growth Simulator: Oak Log",
          machineType: "Tree Growth Simulator",
          minimumTier: "UNKNOWN",
          durationTicks: 100,
          eut: 0,
          inputs: [{ kind: "item", id: "minecraft:sapling", amount: 1, consumed: false }],
          outputs: [
            {
              kind: "item",
              id: "minecraft:log",
              amount: 5,
              neiSlot: { x: 108, y: 36 },
            },
          ],
          machineConfigControls: [
            {
              id: "tgsToolSlot1",
              label: "Tool Slot 1",
              minimumKey: "none",
              defaultKey: "none",
              tiers: [
                {
                  key: "none",
                  label: "-",
                  resource: { kind: "item", id: "empty", amount: 1 },
                },
                {
                  key: "log:saw",
                  label: "Saw",
                  outputMultiplier: 1,
                  resource: { kind: "item", id: "saw", amount: 1 },
                },
              ],
            },
            {
              id: "tgsToolSlot2",
              label: "Tool Slot 2",
              minimumKey: "none",
              defaultKey: "none",
              tiers: [
                {
                  key: "none",
                  label: "-",
                  resource: { kind: "item", id: "empty", amount: 1 },
                },
                {
                  key: "log:chainsaw",
                  label: "Chainsaw",
                  outputMultiplier: 4,
                  resource: { kind: "item", id: "chainsaw", amount: 1 },
                },
              ],
            },
          ],
          source: { recipeMap: "Tree Growth Simulator" },
        },
      ],
      nodes: [
        {
          id: "node",
          recipeId: "tgs-oak",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          machineConfigTiers: { tgsToolSlot1: "log:saw", tgsToolSlot2: "log:chainsaw" },
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      fuelProfiles: [],
    };

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    expect(result.nodes.node.outputs["item:minecraft:log"].amountPerSecond).toBeCloseTo(1.8);
  });
});
