import type { Recipe, ResourceAmount, ResourceKind } from "@/lib/model/types";

export interface NeiPoint {
  x: number;
  y: number;
}

export interface NeiSize {
  width: number;
  height: number;
}

export type NeiSlotSide = "input" | "output";

export interface NeiPositionedSlot {
  side: NeiSlotSide;
  kind: ResourceKind;
  resource: ResourceAmount;
  resourceIndex: number;
  x: number;
  y: number;
}

export interface NeiProgressBar {
  x: number;
  y: number;
  width: number;
  height: number;
  direction: "right" | "up" | "circular";
}

export interface NeiRecipeLayout {
  id: string;
  canvas: NeiSize;
  slotSize: number;
  slots: NeiPositionedSlot[];
  progressBars: NeiProgressBar[];
  logo: NeiPoint;
}

interface RecipeMapLayoutDefinition {
  id: string;
  canvas?: NeiSize;
  maxItemInputs?: number;
  maxItemOutputs?: number;
  maxFluidInputs?: number;
  maxFluidOutputs?: number;
  logo?: NeiPoint;
  itemInputPositions?: PositionGetter;
  itemOutputPositions?: PositionGetter;
  fluidInputPositions?: PositionGetter;
  fluidOutputPositions?: PositionGetter;
  progressBars?: NeiProgressBar[];
}

type PositionGetter = (count: number, definition: RequiredRecipeMapLayoutDefinition) => NeiPoint[];

type RequiredRecipeMapLayoutDefinition = Required<
  Pick<
    RecipeMapLayoutDefinition,
    "maxItemInputs" | "maxItemOutputs" | "maxFluidInputs" | "maxFluidOutputs"
  >
>;

const SLOT_SIZE = 18;
const DEFAULT_CANVAS: NeiSize = { width: 170, height: 82 };
const DEFAULT_PROGRESS_BARS: NeiProgressBar[] = [
  { x: 78, y: 24, width: 20, height: 18, direction: "right" },
];

const LARGE_NEI_MAPS = new Set([
  "Entropic Processing",
  "Large Chemical Reactor",
  "Plasma Arc Furnace",
  "Vacuum Furnace",
  "Vacuum Freezer",
  "Multiblock Centrifuge",
  "Multiblock Electrolyzer",
  "Multiblock Mixer",
  "Multiblock Dehydrator",
  "Transcendent Plasma Mixer",
]);

const ASSEMBLY_LINE_MAPS = new Set([
  "Assemblyline Process",
  "Circuit Assembly Line",
  "Component Assembly Line",
  "Nanochip Assembly Matrix",
]);

const FLUID_ONLY_MAPS = new Set([
  "Fusion Reactor",
  "Liquid Fluoride Thorium Reactor",
  "Nuclear Fuel Processing",
  "Solar Tower",
]);

const RECIPE_MAP_LAYOUTS: Record<string, RecipeMapLayoutDefinition> = {
  "Chemical Plant": {
    id: "gtpp-chemical-plant",
    maxItemInputs: 4,
    maxItemOutputs: 6,
    maxFluidInputs: 4,
    maxFluidOutputs: 3,
    itemInputPositions: (count) => gridPositions(count, 7, 6, Math.max(count, 1), 1),
    itemOutputPositions: (count) => gridPositions(count, 106, 6, 2),
    fluidInputPositions: (count) => gridPositions(count, 7, 41, Math.max(count, 1), 1),
    fluidOutputPositions: (count) => gridPositions(count, 142, 6, 1, Math.max(count, 1)),
  },
  "Distillation Tower": {
    id: "distillation-tower",
    maxItemInputs: 2,
    maxItemOutputs: 1,
    maxFluidInputs: 1,
    maxFluidOutputs: 11,
    logo: { x: 80, y: 62 },
    itemOutputPositions: (count) => (count > 0 ? [{ x: 106, y: 62 }] : []),
    fluidOutputPositions: (count) => {
      const results: NeiPoint[] = [];
      for (let i = 1; i < count + 1; i += 1) {
        results.push({ x: 106 + (i % 3) * SLOT_SIZE, y: 62 - Math.floor(i / 3) * SLOT_SIZE });
      }
      return results;
    },
  },
  "Zhuhai - Fishing Port": {
    id: "zhuhai-fishing-port",
    maxItemInputs: 1,
    maxItemOutputs: 25,
    maxFluidInputs: 0,
    maxFluidOutputs: 0,
    itemInputPositions: (count) => gridPositions(count, 24, 44, 1),
    itemOutputPositions: (count) => gridPositions(count, 78, 8, 5, 5),
  },
};

export function getNeiRecipeLayout(recipe: Recipe): NeiRecipeLayout {
  const recipeMap = recipe.source?.recipeMap ?? recipe.machineType;
  const definition = resolveLayoutDefinition(recipeMap, recipe);
  const requiredDefinition = withRequiredMaxes(definition, recipe);
  const itemInputs = withResourceIndexes(recipe.inputs, "item");
  const fluidInputs = withResourceIndexes(recipe.inputs, "fluid");
  const itemOutputs = withResourceIndexes(recipe.outputs, "item");
  const fluidOutputs = withResourceIndexes(recipe.outputs, "fluid");

  const slots: NeiPositionedSlot[] = [
    ...positionSlots(
      itemInputs,
      "input",
      "item",
      (definition.itemInputPositions ?? defaultItemInputPositions)(
        itemInputs.length,
        requiredDefinition,
      ),
    ),
    ...positionSlots(
      fluidInputs,
      "input",
      "fluid",
      (definition.fluidInputPositions ?? defaultFluidInputPositions)(
        fluidInputs.length,
        requiredDefinition,
      ),
    ),
    ...positionSlots(
      itemOutputs,
      "output",
      "item",
      (definition.itemOutputPositions ?? defaultItemOutputPositions)(
        itemOutputs.length,
        requiredDefinition,
      ),
    ),
    ...positionSlots(
      fluidOutputs,
      "output",
      "fluid",
      (definition.fluidOutputPositions ?? defaultFluidOutputPositions)(
        fluidOutputs.length,
        requiredDefinition,
      ),
    ),
  ];

  const canvas = growCanvas(definition.canvas ?? DEFAULT_CANVAS, slots);

  return {
    id: definition.id,
    canvas,
    slotSize: SLOT_SIZE,
    slots,
    progressBars: definition.progressBars ?? DEFAULT_PROGRESS_BARS,
    logo: definition.logo ?? { x: 152, y: 63 },
  };
}

function resolveLayoutDefinition(recipeMap: string, recipe: Recipe): RecipeMapLayoutDefinition {
  const exact = RECIPE_MAP_LAYOUTS[recipeMap];
  if (exact) {
    return exact;
  }

  if (ASSEMBLY_LINE_MAPS.has(recipeMap)) {
    return {
      id: "assembly-line",
      maxItemInputs: 16,
      maxItemOutputs: 1,
      maxFluidInputs: 4,
      maxFluidOutputs: 0,
      itemInputPositions: (count) => gridPositions(count, 16, 8, 4),
      itemOutputPositions: (count) => (count > 0 ? [{ x: 142, y: 8 }] : []),
      fluidInputPositions: (count) => gridPositions(count, 106, 8, 1),
      progressBars: [
        { x: 88, y: 8, width: 17, height: 72, direction: "right" },
        { x: 124, y: 8, width: 18, height: 72, direction: "right" },
        { x: 146, y: 26, width: 10, height: 18, direction: "up" },
      ],
    };
  }

  if (FLUID_ONLY_MAPS.has(recipeMap)) {
    return {
      id: "fluid-only",
      maxItemInputs: 0,
      maxItemOutputs: 0,
      maxFluidInputs: Math.max(countKind(recipe.inputs, "fluid"), 1),
      maxFluidOutputs: Math.max(countKind(recipe.outputs, "fluid"), 1),
      fluidInputPositions: (count) => defaultItemInputPositions(count),
      fluidOutputPositions: (count) => defaultItemOutputPositions(count),
    };
  }

  if (LARGE_NEI_MAPS.has(recipeMap) || needsLargeLayout(recipe)) {
    const maxItemInputs = Math.max(6, countKind(recipe.inputs, "item"));
    const maxItemOutputs = Math.max(6, countKind(recipe.outputs, "item"));
    const maxFluidInputs = Math.max(6, countKind(recipe.inputs, "fluid"));
    const maxFluidOutputs = Math.max(6, countKind(recipe.outputs, "fluid"));

    return {
      id: "large-nei",
      maxItemInputs,
      maxItemOutputs,
      maxFluidInputs,
      maxFluidOutputs,
      logo: { x: 80, y: 62 },
      canvas: largeCanvas(maxItemInputs, maxItemOutputs, maxFluidInputs, maxFluidOutputs),
      itemInputPositions: largeItemInputPositions,
      itemOutputPositions: largeItemOutputPositions,
      fluidInputPositions: largeFluidInputPositions,
      fluidOutputPositions: largeFluidOutputPositions,
    };
  }

  return {
    id: "default",
  };
}

function defaultItemInputPositions(count: number) {
  switch (count) {
    case 0:
      return [];
    case 1:
      return gridPositions(count, 52, 24, 1, 1);
    case 2:
      return gridPositions(count, 34, 24, 2, 1);
    case 3:
      return gridPositions(count, 16, 24, 3, 1);
    case 4:
      return gridPositions(count, 34, 15, 2, 2);
    case 5:
    case 6:
      return gridPositions(count, 16, 15, 3, 2);
    default:
      return gridPositions(count, 16, 6, 3);
  }
}

function defaultItemOutputPositions(count: number) {
  switch (count) {
    case 0:
      return [];
    case 1:
      return gridPositions(count, 106, 24, 1, 1);
    case 2:
      return gridPositions(count, 106, 24, 2, 1);
    case 3:
      return gridPositions(count, 106, 24, 3, 1);
    case 4:
      return gridPositions(count, 106, 15, 2, 2);
    case 5:
    case 6:
      return gridPositions(count, 106, 15, 3, 2);
    default:
      return gridPositions(count, 106, 6, 3);
  }
}

function defaultFluidInputPositions(count: number) {
  const results: NeiPoint[] = [];
  const base = Math.max(70 - count * SLOT_SIZE, 16);
  for (let i = 0; i < count; i += 1) {
    results.push({ x: base + i * SLOT_SIZE, y: 62 });
  }
  return results;
}

function defaultFluidOutputPositions(count: number) {
  const results: NeiPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    results.push({ x: 106 + i * SLOT_SIZE, y: 62 });
  }
  return results;
}

function largeItemInputPositions(count: number) {
  return gridPositions(count, 16, 8, 3);
}

function largeItemOutputPositions(count: number) {
  return gridPositions(count, 106, 8, 3);
}

function largeFluidInputPositions(count: number, definition: RequiredRecipeMapLayoutDefinition) {
  return gridPositions(count, 16, 8 + getLargeItemRowCount(definition) * SLOT_SIZE, 3);
}

function largeFluidOutputPositions(count: number, definition: RequiredRecipeMapLayoutDefinition) {
  return gridPositions(count, 106, 8 + getLargeItemRowCount(definition) * SLOT_SIZE, 3);
}

function largeCanvas(
  maxItemInputs: number,
  maxItemOutputs: number,
  maxFluidInputs: number,
  maxFluidOutputs: number,
): NeiSize {
  const itemRows =
    Math.max(maxItemInputs, maxItemOutputs) > 0
      ? Math.floor((Math.max(maxItemInputs, maxItemOutputs) - 1) / 3) + 1
      : 0;
  const fluidRows =
    Math.max(maxFluidInputs, maxFluidOutputs) > 0
      ? Math.floor((Math.max(maxFluidInputs, maxFluidOutputs) - 1) / 3) + 1
      : 0;

  return {
    width: 170,
    height: 82 + Math.max(itemRows + fluidRows - 4, 0) * SLOT_SIZE,
  };
}

function getLargeItemRowCount(definition: RequiredRecipeMapLayoutDefinition) {
  return Math.floor((Math.max(definition.maxItemInputs, definition.maxItemOutputs) - 1) / 3) + 1;
}

function gridPositions(
  totalCount: number,
  xOrigin: number,
  yOrigin: number,
  xDirMaxCount: number,
  yDirMaxCount = 100,
): NeiPoint[] {
  const results: NeiPoint[] = [];
  let count = 0;

  for (let y = 0; y < yDirMaxCount; y += 1) {
    for (let x = 0; x < xDirMaxCount; x += 1) {
      if (count >= totalCount) {
        return results;
      }
      results.push({ x: xOrigin + x * SLOT_SIZE, y: yOrigin + y * SLOT_SIZE });
      count += 1;
    }
  }

  return results;
}

function withResourceIndexes(resources: ResourceAmount[], kind: ResourceKind) {
  return resources
    .map((resource, index) => ({ resource, resourceIndex: index }))
    .filter((entry) => entry.resource.kind === kind);
}

function positionSlots(
  resources: Array<{ resource: ResourceAmount; resourceIndex: number }>,
  side: NeiSlotSide,
  kind: ResourceKind,
  positions: NeiPoint[],
): NeiPositionedSlot[] {
  return resources.map(({ resource, resourceIndex }, index) => ({
    side,
    kind,
    resource,
    resourceIndex,
    x: positions[index]?.x ?? 16 + (index % 3) * SLOT_SIZE,
    y: positions[index]?.y ?? 6 + Math.floor(index / 3) * SLOT_SIZE,
  }));
}

function withRequiredMaxes(
  definition: RecipeMapLayoutDefinition,
  recipe: Recipe,
): RequiredRecipeMapLayoutDefinition {
  return {
    maxItemInputs: definition.maxItemInputs ?? Math.max(countKind(recipe.inputs, "item"), 1),
    maxItemOutputs: definition.maxItemOutputs ?? Math.max(countKind(recipe.outputs, "item"), 1),
    maxFluidInputs: definition.maxFluidInputs ?? Math.max(countKind(recipe.inputs, "fluid"), 0),
    maxFluidOutputs: definition.maxFluidOutputs ?? Math.max(countKind(recipe.outputs, "fluid"), 0),
  };
}

function growCanvas(canvas: NeiSize, slots: NeiPositionedSlot[]): NeiSize {
  const maxSlotBottom = Math.max(0, ...slots.map((slot) => slot.y + SLOT_SIZE + 2));
  return {
    width: Math.max(canvas.width, 170),
    height: Math.max(canvas.height, maxSlotBottom + 2),
  };
}

function countKind(resources: ResourceAmount[], kind: ResourceKind) {
  return resources.filter((resource) => resource.kind === kind).length;
}

function needsLargeLayout(recipe: Recipe) {
  return (
    countKind(recipe.inputs, "item") > 6 ||
    countKind(recipe.outputs, "item") > 6 ||
    countKind(recipe.inputs, "fluid") > 3 ||
    countKind(recipe.outputs, "fluid") > 3
  );
}
