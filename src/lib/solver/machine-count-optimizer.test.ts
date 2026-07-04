import { describe, expect, it } from "vitest";
import { makeResourceHandleId } from "@/components/flow/resource-handles";
import { PROJECT_SCHEMA_VERSION, type FactoryEdge, type FactoryProject } from "@/lib/model/types";
import { optimizeMachineCountsForProject } from "./machine-count-optimizer";

function makeNode(id: string, recipeId: string, x: number, machineCount = 1) {
  return {
    id,
    recipeId,
    machineCount,
    parallel: 1,
    overclockTier: "LV" as const,
    enabled: true,
    position: { x, y: 0 },
  };
}

function nodeEdge(id: string, source: string, target: string, resourceId: string): FactoryEdge {
  return {
    id,
    source,
    target,
    sourceHandle: makeResourceHandleId("output", { kind: "item", id: resourceId }, 0),
    targetHandle: makeResourceHandleId("input", { kind: "item", id: resourceId }, 0),
    resourceKind: "item",
    resourceId,
  };
}

describe("optimizeMachineCountsForProject", () => {
  it("scales downstream consumers when explicit demand sits on an upstream producer", () => {
    // Repro for the "only one machine changes" bug: the producer's inputs are external, so
    // upstream propagation finds nothing and previously ONLY the producer scaled.
    // A makes 2 x / machine; target of 8 x/s needs A = 4. B consumes 1 x / machine, so B = 8.
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "upstream-target",
      name: "Upstream target",
      recipes: [
        {
          id: "ra",
          name: "A",
          machineType: "M",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [{ kind: "item", id: "ore", amount: 1 }],
          outputs: [{ kind: "item", id: "x", amount: 2 }],
        },
        {
          id: "rb",
          name: "B",
          machineType: "M",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [{ kind: "item", id: "x", amount: 1 }],
          outputs: [{ kind: "item", id: "y", amount: 1 }],
        },
      ],
      nodes: [
        {
          ...makeNode("A", "ra", 0),
          targetOutput: { kind: "item", resourceId: "x", amountPerSecond: 8 },
        },
        makeNode("B", "rb", 200),
      ],
      storages: [],
      edges: [nodeEdge("e1", "A", "B", "x")],
      fuelProfiles: [],
    };

    const result = optimizeMachineCountsForProject(project);

    expect(result.machineCounts.get("A")).toBe(4);
    expect(result.machineCounts.get("B")).toBe(8);
  });

  it("rebalances suppliers and consumers around an explicitly demanded middle node", () => {
    // A -> B(target y = 10/s) -> C. B needs 10 machines; A feeds B (1 x / y) -> A = 10;
    // C consumes 2 y / machine, so C = 5. All three counts move, in both directions.
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "middle-target",
      name: "Middle target",
      recipes: [
        {
          id: "ra",
          name: "A",
          machineType: "M",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [{ kind: "item", id: "ore", amount: 1 }],
          outputs: [{ kind: "item", id: "x", amount: 1 }],
        },
        {
          id: "rb",
          name: "B",
          machineType: "M",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [{ kind: "item", id: "x", amount: 1 }],
          outputs: [{ kind: "item", id: "y", amount: 1 }],
        },
        {
          id: "rc",
          name: "C",
          machineType: "M",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [{ kind: "item", id: "y", amount: 2 }],
          outputs: [{ kind: "item", id: "z", amount: 1 }],
        },
      ],
      nodes: [
        makeNode("A", "ra", 0),
        {
          ...makeNode("B", "rb", 100),
          targetOutput: { kind: "item", resourceId: "y", amountPerSecond: 10 },
        },
        makeNode("C", "rc", 200),
      ],
      storages: [],
      edges: [nodeEdge("e1", "A", "B", "x"), nodeEdge("e2", "B", "C", "y")],
      fuelProfiles: [],
    };

    const result = optimizeMachineCountsForProject(project);

    expect(result.machineCounts.get("A")).toBe(10);
    expect(result.machineCounts.get("B")).toBe(10);
    expect(result.machineCounts.get("C")).toBe(5);
  });

  it("propagates explicit demand downstream through a storage drawer", () => {
    // A (target 8 x/s) -> drawer -> B. Storage acts as a pass-through connector.
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "through-storage",
      name: "Through storage",
      recipes: [
        {
          id: "ra",
          name: "A",
          machineType: "M",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [{ kind: "item", id: "ore", amount: 1 }],
          outputs: [{ kind: "item", id: "x", amount: 2 }],
        },
        {
          id: "rb",
          name: "B",
          machineType: "M",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [{ kind: "item", id: "x", amount: 1 }],
          outputs: [{ kind: "item", id: "y", amount: 1 }],
        },
      ],
      nodes: [
        {
          ...makeNode("A", "ra", 0),
          targetOutput: { kind: "item", resourceId: "x", amountPerSecond: 8 },
        },
        makeNode("B", "rb", 200),
      ],
      storages: [
        {
          id: "drawer",
          kind: "item",
          resourceId: "x",
          displayName: "X",
          position: { x: 100, y: 0 },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "A",
          target: "drawer",
          resourceKind: "item",
          resourceId: "x",
          label: "X",
        },
        {
          id: "e2",
          source: "drawer",
          target: "B",
          targetHandle: makeResourceHandleId("input", { kind: "item", id: "x" }, 0),
          resourceKind: "item",
          resourceId: "x",
          label: "X",
        },
      ],
      fuelProfiles: [],
    };

    const result = optimizeMachineCountsForProject(project);

    expect(result.machineCounts.get("A")).toBe(4);
    expect(result.machineCounts.get("B")).toBe(8);
  });

  it("is deterministic and idempotent for the same input", () => {
    const build = (): FactoryProject => ({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "deterministic",
      name: "Deterministic",
      recipes: [
        {
          id: "ra",
          name: "A",
          machineType: "M",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [{ kind: "item", id: "ore", amount: 1 }],
          outputs: [{ kind: "item", id: "x", amount: 2 }],
        },
        {
          id: "rb",
          name: "B",
          machineType: "M",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [{ kind: "item", id: "x", amount: 1 }],
          outputs: [{ kind: "item", id: "y", amount: 1 }],
        },
      ],
      nodes: [
        {
          ...makeNode("A", "ra", 0),
          targetOutput: { kind: "item", resourceId: "x", amountPerSecond: 8 },
        },
        makeNode("B", "rb", 200),
      ],
      storages: [],
      edges: [nodeEdge("e1", "A", "B", "x")],
      fuelProfiles: [],
    });

    const first = optimizeMachineCountsForProject(build());
    const second = optimizeMachineCountsForProject(build());

    expect([...second.machineCounts.entries()].sort()).toEqual(
      [...first.machineCounts.entries()].sort(),
    );

    // Feeding the optimized counts back in must be a no-op (stable ratio).
    const balanced = build();
    balanced.nodes = balanced.nodes.map((node) => ({
      ...node,
      machineCount: first.machineCounts.get(node.id) ?? node.machineCount,
    }));
    const third = optimizeMachineCountsForProject(balanced);
    expect(third.machineCounts.get("A")).toBe(4);
    expect(third.machineCounts.get("B")).toBe(8);
  });
});
