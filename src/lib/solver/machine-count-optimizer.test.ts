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

  it("balances a linear chain with a slow middle stage to its true ratio (no target)", () => {
    // Regression for issue #11: a linear chain with NO target must balance proportionally, with
    // the SLOW middle machine getting the highest count -- not one node spiked while the rest
    // collapse to 1. Per machine: source makes 3 x/s; the slow middle (3x the duration) consumes
    // 0.333 x/s and makes 0.333 y/s; the terminal consumes 1 y/s.
    //   source = 1 -> 3 x/s ; middle = 3 / 0.333 = 9 ; terminal = 3 / 1 = 3.
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "slow-middle-chain",
      name: "Slow middle chain",
      recipes: [
        {
          id: "rsource",
          name: "Source",
          machineType: "Pulverizer",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [],
          outputs: [{ kind: "item", id: "x", amount: 3 }],
        },
        {
          id: "rmiddle",
          name: "Slow middle",
          machineType: "Thermal Centrifuge",
          minimumTier: "LV",
          durationTicks: 60,
          eut: 1,
          inputs: [{ kind: "item", id: "x", amount: 1 }],
          outputs: [{ kind: "item", id: "y", amount: 1 }],
        },
        {
          id: "rterminal",
          name: "Terminal",
          machineType: "Macerator",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [{ kind: "item", id: "y", amount: 1 }],
          outputs: [{ kind: "item", id: "z", amount: 1 }],
        },
      ],
      nodes: [
        makeNode("source", "rsource", 0),
        makeNode("middle", "rmiddle", 100),
        makeNode("terminal", "rterminal", 200),
      ],
      storages: [],
      edges: [nodeEdge("e1", "source", "middle", "x"), nodeEdge("e2", "middle", "terminal", "y")],
      fuelProfiles: [],
    };

    const result = optimizeMachineCountsForProject(project);
    const source = result.machineCounts.get("source") ?? 0;
    const middle = result.machineCounts.get("middle") ?? 0;
    const terminal = result.machineCounts.get("terminal") ?? 0;

    // Exact balanced ratio.
    expect(source).toBe(1);
    expect(middle).toBe(9);
    expect(terminal).toBe(3);
    // Qualitative guards against the regression: the slow machine has the highest count, the fast
    // machines are lower, and nothing spikes while the others collapse to 1.
    expect(middle).toBeGreaterThan(source);
    expect(middle).toBeGreaterThan(terminal);
    expect(terminal).toBeGreaterThan(source);
    expect(middle).toBeLessThan(20);
  });

  it("rounds intermediate stages up (ceil) rather than down (floor)", () => {
    // A faster source over-feeds a consumer with a non-integer ratio. The consumer must round UP
    // so it has enough capacity, instead of flooring and leaving the source's output stranded.
    // source = 1 makes 10 x/s ; middle consumes 3 x -> 10/3 = 3.33 -> 4 ; terminal consumes the
    // 3.33 y/s -> 4.
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "ceil-intermediate-chain",
      name: "Ceil intermediate chain",
      recipes: [
        {
          id: "rsource",
          name: "Source",
          machineType: "Pulverizer",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [],
          outputs: [{ kind: "item", id: "x", amount: 10 }],
        },
        {
          id: "rmiddle",
          name: "Middle",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [{ kind: "item", id: "x", amount: 3 }],
          outputs: [{ kind: "item", id: "y", amount: 1 }],
        },
        {
          id: "rterminal",
          name: "Terminal",
          machineType: "Macerator",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [{ kind: "item", id: "y", amount: 1 }],
          outputs: [{ kind: "item", id: "z", amount: 1 }],
        },
      ],
      nodes: [
        makeNode("source", "rsource", 0),
        makeNode("middle", "rmiddle", 100),
        makeNode("terminal", "rterminal", 200),
      ],
      storages: [],
      edges: [nodeEdge("e1", "source", "middle", "x"), nodeEdge("e2", "middle", "terminal", "y")],
      fuelProfiles: [],
    };

    const result = optimizeMachineCountsForProject(project);
    expect(result.machineCounts.get("source")).toBe(1);
    expect(result.machineCounts.get("middle")).toBe(4);
    expect(result.machineCounts.get("terminal")).toBe(4);
  });
});
