import { beforeEach, describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { makeResourceHandleId } from "@/components/flow/resource-handles";
import { useFactoryStore } from "./factory-store";

describe("factory resource links", () => {
  beforeEach(() => {
    useFactoryStore.getState().setProject(createLinkTestProject());
  });

  it("connects matching item recipe slots with explicit handles", () => {
    useFactoryStore.getState().connectNodes("item-source", "item-target", {
      kind: "item",
      id: "dust",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
    });

    expect(useFactoryStore.getState().project.edges).toEqual([
      expect.objectContaining({
        source: "item-source",
        target: "item-target",
        sourceHandle: "output:item:dust:0",
        targetHandle: "input:item:dust:0",
        resourceKind: "item",
        resourceId: "dust",
      }),
    ]);
  });

  it("connects concrete item outputs to ore dictionary inputs", () => {
    useFactoryStore.getState().connectNodes("stick-source", "stick-oredict-target", {
      kind: "item",
      id: "minecraft:stick@0",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "minecraft:stick@0" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "oredict:stickWood" }, 0),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "stick-source",
        target: "stick-oredict-target",
        sourceHandle: "output:item:minecraft%3Astick%400:0",
        targetHandle: "input:item:oredict%3AstickWood:0",
        resourceKind: "item",
        resourceId: "minecraft:stick@0",
      }),
    );
  });

  it("connects tool outputs to matching ore dictionary tool inputs", () => {
    useFactoryStore.getState().connectNodes("screwdriver-source", "screwdriver-oredict-target", {
      kind: "item",
      id: "gregtech:screwdriver.lv@0",
      sourceHandle: makeResourceHandleId(
        "output",
        { kind: "item", id: "gregtech:screwdriver.lv@0" },
        0,
      ),
      targetHandle: makeResourceHandleId(
        "input",
        { kind: "item", id: "oredict:craftingToolScrewdriver" },
        0,
      ),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "screwdriver-source",
        target: "screwdriver-oredict-target",
        sourceHandle: "output:item:gregtech%3Ascrewdriver.lv%400:0",
        targetHandle: "input:item:oredict%3AcraftingToolScrewdriver:0",
        resourceKind: "item",
        resourceId: "gregtech:screwdriver.lv@0",
      }),
    );
  });

  it("connects concrete item drawers to ore dictionary inputs", () => {
    useFactoryStore.getState().connectNodes("stick-drawer", "stick-oredict-target", {
      kind: "item",
      id: "minecraft:stick@0",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "minecraft:stick@0" }),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "oredict:stickWood" }, 0),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "stick-drawer",
        target: "stick-oredict-target",
        resourceKind: "item",
        resourceId: "minecraft:stick@0",
      }),
    );
  });

  it("connects matching fluid recipe slots with explicit handles", () => {
    useFactoryStore.getState().connectNodes("fluid-source", "fluid-target", {
      kind: "fluid",
      id: "water",
      sourceHandle: makeResourceHandleId("output", { kind: "fluid", id: "water" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "fluid", id: "water" }, 0),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "fluid-source",
        target: "fluid-target",
        sourceHandle: "output:fluid:water:0",
        targetHandle: "input:fluid:water:0",
        resourceKind: "fluid",
        resourceId: "water",
      }),
    );
  });

  it("refuses mismatched item and fluid resources", () => {
    useFactoryStore.getState().connectNodes("item-source", "fluid-target", {
      kind: "item",
      id: "dust",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "fluid", id: "water" }, 0),
    });

    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
  });

  it("connects recipe outputs into matching drawers or tanks", () => {
    useFactoryStore.getState().connectNodes("fluid-source", "water-tank", {
      kind: "fluid",
      id: "water",
      sourceHandle: makeResourceHandleId("output", { kind: "fluid", id: "water" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "fluid", id: "water" }),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "fluid-source",
        target: "water-tank",
        targetHandle: "input:fluid:water",
        resourceKind: "fluid",
        resourceId: "water",
      }),
    );
  });

  it("connects matching drawers or tanks into recipe inputs", () => {
    useFactoryStore.getState().connectNodes("dust-drawer", "item-target", {
      kind: "item",
      id: "dust",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "dust-drawer",
        target: "item-target",
        sourceHandle: "output:item:dust",
        resourceKind: "item",
        resourceId: "dust",
      }),
    );
  });

  it("does not create multiple storage cards from the same recipe slot", () => {
    const store = useFactoryStore.getState();
    store.addStorageForConnection(
      { kind: "item", id: "dust", displayName: "Dust" },
      "item-source",
      "output",
      { x: 320, y: 20 },
      makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
    );
    store.addStorageForConnection(
      { kind: "item", id: "dust", displayName: "Dust" },
      "item-source",
      "output",
      { x: 420, y: 20 },
      makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
    );

    const dustStorages =
      useFactoryStore
        .getState()
        .project.storages?.filter((storage) => storage.resourceId === "dust") ?? [];
    const createdDustStorages = dustStorages.filter((storage) => storage.id !== "dust-drawer");

    expect(createdDustStorages).toHaveLength(1);
    expect(useFactoryStore.getState().project.edges).toHaveLength(1);
    expect(useFactoryStore.getState().project.edges[0]?.target).toBe(createdDustStorages[0]?.id);
  });

  it("allows separate storage cards for the same resource on different recipe slots", () => {
    const store = useFactoryStore.getState();
    store.addStorageForConnection(
      { kind: "item", id: "dust", displayName: "Dust" },
      "item-source",
      "output",
      { x: 320, y: 20 },
      makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
    );
    store.addStorageForConnection(
      { kind: "item", id: "dust", displayName: "Dust" },
      "item-target",
      "input",
      { x: 420, y: 20 },
      makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
    );

    const createdDustStorages =
      useFactoryStore
        .getState()
        .project.storages?.filter((storage) => storage.resourceId === "dust")
        .filter((storage) => storage.id !== "dust-drawer") ?? [];

    expect(createdDustStorages).toHaveLength(2);
    expect(useFactoryStore.getState().project.edges).toHaveLength(2);
  });

  it("does not connect storage to non-consumed recipe inputs", () => {
    useFactoryStore.getState().connectNodes("mold-drawer", "nc-target", {
      kind: "item",
      id: "mold",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "mold" }),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "mold" }, 0),
    });

    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
  });

  it("connects pending fluid slots regardless of click order", () => {
    const store = useFactoryStore.getState();
    store.selectResourceConnectionSlot({
      nodeId: "fluid-target",
      side: "input",
      kind: "fluid",
      resourceId: "water",
      displayName: "Water",
      handleId: makeResourceHandleId("input", { kind: "fluid", id: "water" }, 0),
    });
    useFactoryStore.getState().selectResourceConnectionSlot({
      nodeId: "fluid-source",
      side: "output",
      kind: "fluid",
      resourceId: "water",
      displayName: "Water",
      handleId: makeResourceHandleId("output", { kind: "fluid", id: "water" }, 0),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "fluid-source",
        target: "fluid-target",
        resourceKind: "fluid",
        resourceId: "water",
      }),
    );
  });

  it("removes an existing resource edge when the same slots are linked again", () => {
    const firstSlot = {
      nodeId: "item-source",
      side: "output" as const,
      kind: "item" as const,
      resourceId: "dust",
      displayName: "Dust",
      handleId: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
    };
    const secondSlot = {
      nodeId: "item-target",
      side: "input" as const,
      kind: "item" as const,
      resourceId: "dust",
      displayName: "Dust",
      handleId: makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
    };

    useFactoryStore.getState().selectResourceConnectionSlot(firstSlot);
    useFactoryStore.getState().selectResourceConnectionSlot(secondSlot);
    expect(useFactoryStore.getState().project.edges).toHaveLength(1);

    useFactoryStore.getState().selectResourceConnectionSlot(firstSlot);
    useFactoryStore.getState().selectResourceConnectionSlot(secondSlot);
    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
  });

  it("removes an orphan drawer or tank when its last edge is deleted", () => {
    useFactoryStore.getState().connectNodes("fluid-source", "water-tank", {
      kind: "fluid",
      id: "water",
      sourceHandle: makeResourceHandleId("output", { kind: "fluid", id: "water" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "fluid", id: "water" }),
    });
    const edgeId = useFactoryStore.getState().project.edges[0]?.id;
    expect(useFactoryStore.getState().project.storages).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "water-tank" })]),
    );

    useFactoryStore.getState().deleteEdge(edgeId);

    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
    expect(useFactoryStore.getState().project.storages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "water-tank" })]),
    );
  });

  it("undoes and redoes structural project edits", () => {
    useFactoryStore.getState().connectNodes("item-source", "item-target", {
      kind: "item",
      id: "dust",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
    });
    expect(useFactoryStore.getState().project.edges).toHaveLength(1);

    useFactoryStore.getState().undo();
    expect(useFactoryStore.getState().project.edges).toHaveLength(0);

    useFactoryStore.getState().redo();
    expect(useFactoryStore.getState().project.edges).toHaveLength(1);
  });

  it("clears redo history after a new edit", () => {
    useFactoryStore.getState().updateNode("item-source", { machineCount: 4 });
    useFactoryStore.getState().undo();
    expect(useFactoryStore.getState().redoHistory).toHaveLength(1);

    useFactoryStore.getState().updateNode("item-source", { overclockTier: "HV" });

    expect(useFactoryStore.getState().redoHistory).toHaveLength(0);
    expect(
      useFactoryStore.getState().project.nodes.find((node) => node.id === "item-source")
        ?.overclockTier,
    ).toBe("HV");
  });

  it("removes storage links when a node is changed to a recipe that no longer references it", () => {
    useFactoryStore.getState().connectNodes("fluid-source", "water-tank", {
      kind: "fluid",
      id: "water",
      sourceHandle: makeResourceHandleId("output", { kind: "fluid", id: "water" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "fluid", id: "water" }),
    });

    useFactoryStore.getState().updateNode("fluid-source", { recipeId: "item-source-recipe" });

    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
    expect(useFactoryStore.getState().project.storages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "water-tank" })]),
    );
  });

  it("links a sodium to NaK coolant fluid chain without creating storage", () => {
    useFactoryStore.getState().setProject(createNakCoolantProject());

    useFactoryStore.getState().connectNodes("fluid-heater", "distillery", {
      kind: "fluid",
      id: "liquid_sodium",
      sourceHandle: makeResourceHandleId("output", { kind: "fluid", id: "liquid_sodium" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "fluid", id: "liquid_sodium" }, 1),
    });
    useFactoryStore.getState().connectNodes("distillery", "fluid-canner", {
      kind: "fluid",
      id: "sodium_potassium",
      sourceHandle: makeResourceHandleId("output", { kind: "fluid", id: "sodium_potassium" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "fluid", id: "sodium_potassium" }, 1),
    });

    expect(useFactoryStore.getState().project.storages).toHaveLength(0);
    expect(useFactoryStore.getState().project.edges).toEqual([
      expect.objectContaining({
        source: "fluid-heater",
        target: "distillery",
        resourceKind: "fluid",
        resourceId: "liquid_sodium",
      }),
      expect.objectContaining({
        source: "distillery",
        target: "fluid-canner",
        resourceKind: "fluid",
        resourceId: "sodium_potassium",
      }),
    ]);
  });
});

describe("project recipe refresh", () => {
  it("replaces stale machine handlers from the loaded dataset recipe", () => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "refresh-test",
      name: "Refresh test",
      fuelProfiles: [],
      recipes: [
        {
          id: "fluid-extractor-recipe",
          name: "Fluid Extractor: Charcoal",
          machineType: "Fluid Extractor",
          minimumTier: "LV",
          durationTicks: 30,
          eut: 16,
          inputs: [{ kind: "item", id: "minecraft:coal@1", amount: 1 }],
          outputs: [{ kind: "fluid", id: "woodtar", amount: 100 }],
          machineHandlers: [
            {
              id: "nei-catalyst-basic-fluid-extractor",
              label: "Basic Fluid Extractor",
              machineType: "Basic Fluid Extractor",
              minimumTier: "LV",
              kind: "single",
            },
          ],
        },
      ],
      nodes: [
        {
          id: "node-1",
          recipeId: "fluid-extractor-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          machineHandlerId: "nei-catalyst-basic-fluid-extractor",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    });

    useFactoryStore.getState().refreshProjectRecipes([
      {
        id: "fluid-extractor-recipe",
        name: "Fluid Extractor: Charcoal",
        machineType: "Fluid Extractor",
        minimumTier: "LV",
        durationTicks: 30,
        eut: 16,
        inputs: [{ kind: "item", id: "minecraft:coal@1", amount: 1 }],
        outputs: [{ kind: "fluid", id: "woodtar", amount: 100 }],
      },
    ]);

    expect(useFactoryStore.getState().project.recipes[0]?.machineHandlers).toBeUndefined();
    expect(useFactoryStore.getState().project.nodes[0]?.machineHandlerId).toBeUndefined();
  });

  it("preserves a concrete ore dictionary input selected on a recipe node", () => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "refresh-context-test",
      name: "Refresh context test",
      fuelProfiles: [],
      recipes: [
        {
          id: "coke-oven-log",
          name: "Coke Oven: Charcoal",
          machineType: "Coke Oven",
          minimumTier: "MV",
          durationTicks: 256,
          eut: 96,
          inputs: [
            {
              kind: "item",
              id: "minecraft:log@1",
              amount: 16,
              displayName: "Spruce Log",
            },
          ],
          outputs: [{ kind: "item", id: "minecraft:coal@1", amount: 20 }],
        },
      ],
      nodes: [
        {
          id: "node-1",
          recipeId: "coke-oven-log",
          machineCount: 1,
          parallel: 1,
          overclockTier: "MV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    });

    useFactoryStore.getState().refreshProjectRecipes([
      {
        id: "coke-oven-log",
        name: "Coke Oven: Charcoal",
        machineType: "Coke Oven",
        minimumTier: "MV",
        durationTicks: 256,
        eut: 96,
        inputs: [
          {
            kind: "item",
            id: "oredict:logWood",
            amount: 16,
            displayName: "Oak Log",
            alternatives: [{ kind: "item", id: "minecraft:log@1" }],
          },
        ],
        outputs: [{ kind: "item", id: "minecraft:coal@1", amount: 20 }],
      },
    ]);

    expect(useFactoryStore.getState().project.recipes[0]?.inputs[0]).toEqual(
      expect.objectContaining({
        id: "minecraft:log@1",
        displayName: "Spruce Log",
        alternatives: undefined,
      }),
    );
  });

  it("stores concrete uses inputs on connected recipe nodes", () => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "connected-context-test",
      name: "Connected context test",
      fuelProfiles: [],
      recipes: [
        {
          id: "drawer-source",
          name: "Drawer",
          machineType: "Drawer",
          minimumTier: "NONE",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "minecraft:log@1", amount: 1, displayName: "Spruce Log" }],
        },
      ],
      nodes: [
        {
          id: "source-node",
          recipeId: "drawer-source",
          machineCount: 1,
          parallel: 1,
          overclockTier: "NONE",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    });

    useFactoryStore.getState().addConnectedNodeForRecipeObject(
      {
        id: "coke-oven-log",
        name: "Coke Oven: Charcoal",
        machineType: "Coke Oven",
        minimumTier: "MV",
        durationTicks: 256,
        eut: 96,
        inputs: [
          {
            kind: "item",
            id: "minecraft:log@1",
            amount: 16,
            displayName: "Spruce Log",
          },
        ],
        outputs: [{ kind: "item", id: "minecraft:coal@1", amount: 20 }],
      },
      "source-node",
      { kind: "item", id: "minecraft:log@1", displayName: "Spruce Log", mode: "uses" },
    );

    const node = useFactoryStore
      .getState()
      .project.nodes.find((entry) => entry.recipeId === "coke-oven-log");

    expect(node?.recipeInputOverrides?.["0"]).toEqual(
      expect.objectContaining({
        id: "minecraft:log@1",
        displayName: "Spruce Log",
        alternatives: undefined,
      }),
    );
  });
});

describe("factory machine count optimization", () => {
  it("propagates suggested machine counts through connected recipe chains", () => {
    useFactoryStore.getState().setProject(createRatioOptimizationProject());

    useFactoryStore.getState().optimizeMachineCounts();

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "dust-source", machineCount: 10 }),
        expect.objectContaining({ id: "plate-target", machineCount: 10 }),
      ]),
    );
  });

  it("normalizes every optimized machine count to an integer", () => {
    const project = createRatioOptimizationProject();
    useFactoryStore.getState().setProject({
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "dust-source" ? { ...node, machineCount: 1.6 } : node,
      ),
      edges: [],
    });

    useFactoryStore.getState().optimizeMachineCounts();

    expect(
      useFactoryStore.getState().project.nodes.every((node) => Number.isInteger(node.machineCount)),
    ).toBe(true);
  });

  it("rounds optimized machine counts up to keep logistical surplus", () => {
    const project = createRatioOptimizationProject();
    useFactoryStore.getState().setProject({
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "plate-target"
          ? {
              ...node,
              targetOutput: {
                kind: "item",
                resourceId: "plate",
                amountPerSecond: 1.4,
              },
            }
          : node,
      ),
    });

    useFactoryStore.getState().optimizeMachineCounts();

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "dust-source", machineCount: 2 }),
        expect.objectContaining({ id: "plate-target", machineCount: 2 }),
      ]),
    );
    expect(useFactoryStore.getState().lastResult.externalInputs).toHaveLength(0);
  });

  it("does not amplify cyclic recipe chains across optimization passes", () => {
    useFactoryStore.getState().setProject(createCyclicRatioProject());

    useFactoryStore.getState().optimizeMachineCounts();

    const machineCounts = useFactoryStore.getState().project.nodes.map((node) => node.machineCount);

    expect(machineCounts.every((machineCount) => Number.isInteger(machineCount))).toBe(true);
    expect(Math.max(...machineCounts)).toBeLessThanOrEqual(2);
  });

  it("does not amplify cycles connected through separate buses for the same resource", () => {
    useFactoryStore.getState().setProject(createStorageBusCycleProject());

    useFactoryStore.getState().optimizeMachineCounts();
    useFactoryStore.getState().optimizeMachineCounts();
    useFactoryStore.getState().optimizeMachineCounts();

    const machineCounts = useFactoryStore.getState().project.nodes.map((node) => node.machineCount);

    expect(machineCounts.every((machineCount) => Number.isInteger(machineCount))).toBe(true);
    expect(Math.max(...machineCounts)).toBeLessThanOrEqual(2);
  });

  it("rounds small cyclic bottlenecks below full usage", () => {
    const project = createSmallCyclicBottleneckProject();
    useFactoryStore.getState().setProject({
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "small-cycle-source"
          ? { ...node, machineCount: 50 }
          : { ...node, machineCount: 51 },
      ),
    });

    useFactoryStore.getState().optimizeMachineCount("small-cycle-source");

    const source = useFactoryStore
      .getState()
      .project.nodes.find((node) => node.id === "small-cycle-source");
    const sourceResult = useFactoryStore.getState().lastResult.nodes["small-cycle-source"];

    expect(source?.machineCount).toBe(52);
    expect(sourceResult?.utilization).toBeLessThan(1);
  });

  it("keeps global optimization idempotent across repeated clicks", () => {
    useFactoryStore.getState().setProject(createStorageBusCycleProject());

    useFactoryStore.getState().optimizeMachineCounts();
    const firstCounts = useFactoryStore
      .getState()
      .project.nodes.map((node) => [node.id, node.machineCount]);

    useFactoryStore.getState().optimizeMachineCounts();
    useFactoryStore.getState().optimizeMachineCounts();

    expect(
      useFactoryStore.getState().project.nodes.map((node) => [node.id, node.machineCount]),
    ).toEqual(firstCounts);
  });

  it("ignores placeholder machine counts during global optimization", () => {
    const project = createAcyclicStorageBusProject();
    const placeholderProject = {
      ...project,
      nodes: project.nodes.map((node) => ({
        ...node,
        machineCount: node.id === "bus-source" ? 999 : 37,
      })),
    };

    useFactoryStore.getState().setProject(project);
    useFactoryStore.getState().optimizeMachineCounts();
    const baselineCounts = useFactoryStore
      .getState()
      .project.nodes.map((node) => [node.id, node.machineCount]);

    useFactoryStore.getState().setProject(placeholderProject);
    useFactoryStore.getState().optimizeMachineCounts();

    expect(
      useFactoryStore.getState().project.nodes.map((node) => [node.id, node.machineCount]),
    ).toEqual(baselineCounts);
  });

  it("does not count pure storage sinks as extra ratio demand", () => {
    useFactoryStore.getState().setProject(createRecipeChainWithStorageSinkProject());

    useFactoryStore.getState().optimizeMachineCounts();
    useFactoryStore.getState().optimizeMachineCounts();

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "sink-source", machineCount: 10 }),
        expect.objectContaining({ id: "sink-target", machineCount: 10 }),
      ]),
    );
  });

  it("does not let surplus storage sinks pin single-node optimization to the current count", () => {
    const project = createRecipeChainWithStorageSinkProject();
    useFactoryStore.getState().setProject({
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "sink-source"
          ? { ...node, machineCount: 3 }
          : {
              ...node,
              targetOutput: {
                kind: "item",
                resourceId: "plate",
                amountPerSecond: 1,
              },
            },
      ),
    });

    useFactoryStore.getState().optimizeMachineCount("sink-source");

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "sink-source", machineCount: 1 })]),
    );
  });

  it("keeps single-node optimization idempotent across repeated clicks", () => {
    useFactoryStore.getState().setProject(createStorageBusCycleProject());

    useFactoryStore.getState().optimizeMachineCount("bus-cycle-b");
    const firstCount = useFactoryStore
      .getState()
      .project.nodes.find((node) => node.id === "bus-cycle-b")?.machineCount;

    useFactoryStore.getState().optimizeMachineCount("bus-cycle-b");
    useFactoryStore.getState().optimizeMachineCount("bus-cycle-b");

    expect(
      useFactoryStore.getState().project.nodes.find((node) => node.id === "bus-cycle-b")
        ?.machineCount,
    ).toBe(firstCount);
  });

  it("still propagates ratios through separate buses when there is no feedback loop", () => {
    useFactoryStore.getState().setProject(createAcyclicStorageBusProject());

    useFactoryStore.getState().optimizeMachineCounts();

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "bus-source", machineCount: 10 }),
        expect.objectContaining({ id: "bus-target", machineCount: 10 }),
      ]),
    );
  });
});

function createLinkTestProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "link-test",
    name: "Link test",
    recipes: [
      {
        id: "item-source-recipe",
        name: "Item source",
        machineType: "Source",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [{ kind: "item", id: "dust", amount: 1 }],
      },
      {
        id: "item-target-recipe",
        name: "Item target",
        machineType: "Target",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [{ kind: "item", id: "plate", amount: 1 }],
      },
      {
        id: "fluid-source-recipe",
        name: "Fluid source",
        machineType: "Pump",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [{ kind: "fluid", id: "water", amount: 1000 }],
      },
      {
        id: "fluid-target-recipe",
        name: "Fluid target",
        machineType: "Canner",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "fluid", id: "water", amount: 1000 }],
        outputs: [{ kind: "item", id: "cell", amount: 1 }],
      },
      {
        id: "nc-target-recipe",
        name: "Non consumed target",
        machineType: "Extruder",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "mold", amount: 1, consumed: false }],
        outputs: [{ kind: "item", id: "gear", amount: 1 }],
      },
      {
        id: "stick-source-recipe",
        name: "Stick source",
        machineType: "Source",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [{ kind: "item", id: "minecraft:stick@0", amount: 1, displayName: "Stick" }],
      },
      {
        id: "stick-oredict-target-recipe",
        name: "Ore dictionary target",
        machineType: "Crafting",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [
          {
            kind: "item",
            id: "oredict:stickWood",
            amount: 1,
            displayName: "Stick",
            alternatives: [
              { kind: "item", id: "minecraft:stick@0", displayName: "Stick" },
              { kind: "item", id: "other:stick@0", displayName: "Other Stick" },
            ],
          },
        ],
        outputs: [{ kind: "item", id: "crafted", amount: 1 }],
      },
      {
        id: "screwdriver-source-recipe",
        name: "Screwdriver source",
        machineType: "Source",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [
          {
            kind: "item",
            id: "gregtech:screwdriver.lv@0",
            amount: 1,
            displayName: "Screwdriver (LV)",
          },
        ],
      },
      {
        id: "screwdriver-oredict-target-recipe",
        name: "Ore dictionary tool target",
        machineType: "Crafting",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [
          {
            kind: "item",
            id: "oredict:craftingToolScrewdriver",
            amount: 1,
            displayName: "Screwdriver",
            alternatives: [
              {
                kind: "item",
                id: "gregtech:screwdriver.lv@0",
                displayName: "Screwdriver (LV)",
              },
              {
                kind: "item",
                id: "gregtech:screwdriver.mv@0",
                displayName: "Screwdriver (MV)",
              },
            ],
          },
        ],
        outputs: [{ kind: "item", id: "tool-crafted", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("item-source", "item-source-recipe", 0),
      makeNode("item-target", "item-target-recipe", 200),
      makeNode("fluid-source", "fluid-source-recipe", 0, 140),
      makeNode("fluid-target", "fluid-target-recipe", 200, 140),
      makeNode("nc-target", "nc-target-recipe", 200, 280),
      makeNode("stick-source", "stick-source-recipe", 0, 420),
      makeNode("stick-oredict-target", "stick-oredict-target-recipe", 200, 420),
      makeNode("screwdriver-source", "screwdriver-source-recipe", 0, 560),
      makeNode("screwdriver-oredict-target", "screwdriver-oredict-target-recipe", 200, 560),
    ],
    storages: [
      {
        id: "dust-drawer",
        kind: "item",
        resourceId: "dust",
        displayName: "Dust",
        position: { x: 100, y: 0 },
      },
      {
        id: "mold-drawer",
        kind: "item",
        resourceId: "mold",
        displayName: "Mold",
        position: { x: 100, y: 280 },
      },
      {
        id: "water-tank",
        kind: "fluid",
        resourceId: "water",
        displayName: "Water",
        position: { x: 100, y: 140 },
      },
      {
        id: "stick-drawer",
        kind: "item",
        resourceId: "minecraft:stick@0",
        displayName: "Stick",
        position: { x: 100, y: 420 },
      },
    ],
    edges: [],
    fuelProfiles: [],
  };
}

function createRatioOptimizationProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "ratio-optimization",
    name: "Ratio optimization",
    recipes: [
      {
        id: "dust-source-recipe",
        name: "Dust source",
        machineType: "Macerator",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [{ kind: "item", id: "dust", amount: 1 }],
      },
      {
        id: "plate-target-recipe",
        name: "Plate target",
        machineType: "Assembler",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [{ kind: "item", id: "plate", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("dust-source", "dust-source-recipe", 0),
      {
        ...makeNode("plate-target", "plate-target-recipe", 240),
        targetOutput: {
          kind: "item",
          resourceId: "plate",
          amountPerSecond: 10,
        },
      },
    ],
    storages: [],
    edges: [
      {
        id: "dust-edge",
        source: "dust-source",
        target: "plate-target",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
        resourceKind: "item",
        resourceId: "dust",
      },
    ],
    fuelProfiles: [],
  };
}

function createCyclicRatioProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "cycle-ratio",
    name: "Cycle ratio",
    recipes: [
      {
        id: "cycle-a-recipe",
        name: "Cycle A",
        machineType: "A",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "y", amount: 2 }],
        outputs: [{ kind: "item", id: "x", amount: 1 }],
      },
      {
        id: "cycle-b-recipe",
        name: "Cycle B",
        machineType: "B",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "x", amount: 2 }],
        outputs: [{ kind: "item", id: "y", amount: 1 }],
      },
    ],
    nodes: [
      {
        ...makeNode("cycle-a", "cycle-a-recipe", 0),
        targetOutput: {
          kind: "item",
          resourceId: "x",
          amountPerSecond: 2,
        },
      },
      makeNode("cycle-b", "cycle-b-recipe", 240),
    ],
    storages: [],
    edges: [
      {
        id: "x-edge",
        source: "cycle-a",
        target: "cycle-b",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "x" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "x" }, 0),
        resourceKind: "item",
        resourceId: "x",
      },
      {
        id: "y-edge",
        source: "cycle-b",
        target: "cycle-a",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "y" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "y" }, 0),
        resourceKind: "item",
        resourceId: "y",
      },
    ],
    fuelProfiles: [],
  };
}

function createStorageBusCycleProject(): FactoryProject {
  return {
    ...createCyclicRatioProject(),
    id: "storage-bus-cycle-ratio",
    nodes: [
      {
        ...makeNode("bus-cycle-a", "cycle-a-recipe", 0),
        targetOutput: {
          kind: "item",
          resourceId: "x",
          amountPerSecond: 2,
        },
      },
      makeNode("bus-cycle-b", "cycle-b-recipe", 240),
    ],
    storages: [
      { id: "x-out", kind: "item", resourceId: "x", position: { x: 120, y: 0 } },
      { id: "x-in", kind: "item", resourceId: "x", position: { x: 160, y: 0 } },
      { id: "y-out", kind: "item", resourceId: "y", position: { x: 120, y: 140 } },
      { id: "y-in", kind: "item", resourceId: "y", position: { x: 160, y: 140 } },
    ],
    edges: [
      {
        id: "x-out-edge",
        source: "bus-cycle-a",
        target: "x-out",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "x" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "x" }),
        resourceKind: "item",
        resourceId: "x",
      },
      {
        id: "x-in-edge",
        source: "x-in",
        target: "bus-cycle-b",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "x" }),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "x" }, 0),
        resourceKind: "item",
        resourceId: "x",
      },
      {
        id: "y-out-edge",
        source: "bus-cycle-b",
        target: "y-out",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "y" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "y" }),
        resourceKind: "item",
        resourceId: "y",
      },
      {
        id: "y-in-edge",
        source: "y-in",
        target: "bus-cycle-a",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "y" }),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "y" }, 0),
        resourceKind: "item",
        resourceId: "y",
      },
    ],
  };
}

function createSmallCyclicBottleneckProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "small-cycle-bottleneck",
    name: "Small cycle bottleneck",
    recipes: [
      {
        id: "small-cycle-source-recipe",
        name: "Small Cycle Source",
        machineType: "A",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "seed", amount: 1 }],
        outputs: [{ kind: "item", id: "product", amount: 1 }],
      },
      {
        id: "small-cycle-return-recipe",
        name: "Small Cycle Return",
        machineType: "B",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "product", amount: 1 }],
        outputs: [{ kind: "item", id: "seed", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("small-cycle-source", "small-cycle-source-recipe", 0),
      {
        ...makeNode("small-cycle-return", "small-cycle-return-recipe", 240),
        targetOutput: {
          kind: "item",
          resourceId: "seed",
          amountPerSecond: 50.2,
        },
      },
    ],
    storages: [],
    edges: [
      {
        id: "small-cycle-product-edge",
        source: "small-cycle-source",
        target: "small-cycle-return",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "product" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "product" }, 0),
        resourceKind: "item",
        resourceId: "product",
      },
      {
        id: "small-cycle-seed-edge",
        source: "small-cycle-return",
        target: "small-cycle-source",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "seed" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "seed" }, 0),
        resourceKind: "item",
        resourceId: "seed",
      },
    ],
    fuelProfiles: [],
  };
}

function createAcyclicStorageBusProject(): FactoryProject {
  return {
    ...createRatioOptimizationProject(),
    id: "acyclic-storage-bus-ratio",
    nodes: [
      makeNode("bus-source", "dust-source-recipe", 0),
      {
        ...makeNode("bus-target", "plate-target-recipe", 240),
        targetOutput: {
          kind: "item",
          resourceId: "plate",
          amountPerSecond: 10,
        },
      },
    ],
    storages: [
      { id: "dust-out", kind: "item", resourceId: "dust", position: { x: 100, y: 0 } },
      { id: "dust-in", kind: "item", resourceId: "dust", position: { x: 140, y: 0 } },
    ],
    edges: [
      {
        id: "dust-out-edge",
        source: "bus-source",
        target: "dust-out",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }),
        resourceKind: "item",
        resourceId: "dust",
      },
      {
        id: "dust-in-edge",
        source: "dust-in",
        target: "bus-target",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
        resourceKind: "item",
        resourceId: "dust",
      },
    ],
  };
}

function createRecipeChainWithStorageSinkProject(): FactoryProject {
  return {
    ...createRatioOptimizationProject(),
    id: "recipe-chain-with-storage-sink",
    nodes: [
      makeNode("sink-source", "dust-source-recipe", 0),
      {
        ...makeNode("sink-target", "plate-target-recipe", 240),
        targetOutput: {
          kind: "item",
          resourceId: "plate",
          amountPerSecond: 10,
        },
      },
    ],
    storages: [{ id: "dust-sink", kind: "item", resourceId: "dust", position: { x: 120, y: 120 } }],
    edges: [
      {
        id: "sink-target-edge",
        source: "sink-source",
        target: "sink-target",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
        resourceKind: "item",
        resourceId: "dust",
      },
      {
        id: "sink-storage-edge",
        source: "sink-source",
        target: "dust-sink",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }),
        resourceKind: "item",
        resourceId: "dust",
      },
    ],
  };
}

function makeNode(id: string, recipeId: string, x: number, y = 0) {
  return {
    id,
    recipeId,
    machineCount: 1,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x, y },
  };
}

function createNakCoolantProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "nak-chain",
    name: "NaK chain",
    recipes: [
      {
        id: "fluid-heater-recipe",
        name: "Fluid Heater: Sodium",
        machineType: "Fluid Heater",
        minimumTier: "MV",
        durationTicks: 200,
        eut: 120,
        inputs: [{ kind: "item", id: "sodium_dust", amount: 1 }],
        outputs: [{ kind: "fluid", id: "liquid_sodium", amount: 1000 }],
      },
      {
        id: "distillery-recipe",
        name: "Distillery: Sodium Potassium",
        machineType: "Distillery",
        minimumTier: "LV",
        durationTicks: 400,
        eut: 30,
        inputs: [
          { kind: "item", id: "rock_salt", amount: 1 },
          { kind: "fluid", id: "liquid_sodium", amount: 1000 },
        ],
        outputs: [{ kind: "fluid", id: "sodium_potassium", amount: 1000 }],
      },
      {
        id: "fluid-canner-recipe",
        name: "Fluid Canner: 60k NaK Coolant Cell",
        machineType: "Fluid Canner",
        minimumTier: "LV",
        durationTicks: 200,
        eut: 30,
        inputs: [
          { kind: "item", id: "10k_cell", amount: 1 },
          { kind: "fluid", id: "sodium_potassium", amount: 1000 },
        ],
        outputs: [{ kind: "item", id: "60k_nak_coolant_cell", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("fluid-heater", "fluid-heater-recipe", 0, 0),
      makeNode("distillery", "distillery-recipe", 300, 0),
      makeNode("fluid-canner", "fluid-canner-recipe", 600, 0),
    ],
    storages: [],
    edges: [],
    fuelProfiles: [],
  };
}
