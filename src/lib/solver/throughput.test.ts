import { describe, expect, it } from "vitest";
import { demoFuelProfiles } from "@/lib/model/fuels";
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
      fuelProfiles: demoFuelProfiles,
      selectedFuelProfileId: "demo-biodiesel",
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
});
