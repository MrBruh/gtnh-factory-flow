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
    ],
    nodes: [
      makeNode("item-source", "item-source-recipe", 0),
      makeNode("item-target", "item-target-recipe", 200),
      makeNode("fluid-source", "fluid-source-recipe", 0, 140),
      makeNode("fluid-target", "fluid-target-recipe", 200, 140),
      makeNode("nc-target", "nc-target-recipe", 200, 280),
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
    ],
    edges: [],
    fuelProfiles: [],
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
