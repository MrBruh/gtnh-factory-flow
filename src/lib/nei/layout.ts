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
  slotIndex: number;
  x: number;
  y: number;
}

export interface NeiSlotFrame {
  side: NeiSlotSide;
  kind: ResourceKind;
  resource?: ResourceAmount;
  resourceIndex?: number;
  slotIndex: number;
  x: number;
  y: number;
}

export type NeiProgressTexture =
  | "arrow"
  | "arrow_multiple"
  | "assemblyline_1"
  | "assemblyline_2"
  | "assemblyline_3";

export interface NeiProgressBar {
  x: number;
  y: number;
  width: number;
  height: number;
  direction: "right" | "up" | "circular";
  texture: NeiProgressTexture;
}

export interface NeiRecipeLayout {
  id: string;
  canvas: NeiSize;
  slotSize: number;
  frames: NeiSlotFrame[];
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
  { x: 78, y: 24, width: 20, height: 18, direction: "right", texture: "arrow" },
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
    progressBars: DEFAULT_PROGRESS_BARS,
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
    progressBars: DEFAULT_PROGRESS_BARS,
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

  const frames: NeiSlotFrame[] = [
    ...positionFrames(
      itemInputs,
      "input",
      "item",
      (definition.itemInputPositions ?? defaultItemInputPositions)(
        Math.max(itemInputs.length, requiredDefinition.maxItemInputs),
        requiredDefinition,
      ),
    ),
    ...positionFrames(
      fluidInputs,
      "input",
      "fluid",
      (definition.fluidInputPositions ?? defaultFluidInputPositions)(
        Math.max(fluidInputs.length, requiredDefinition.maxFluidInputs),
        requiredDefinition,
      ),
    ),
    ...positionFrames(
      itemOutputs,
      "output",
      "item",
      (definition.itemOutputPositions ?? defaultItemOutputPositions)(
        Math.max(itemOutputs.length, requiredDefinition.maxItemOutputs),
        requiredDefinition,
      ),
    ),
    ...positionFrames(
      fluidOutputs,
      "output",
      "fluid",
      (definition.fluidOutputPositions ?? defaultFluidOutputPositions)(
        Math.max(fluidOutputs.length, requiredDefinition.maxFluidOutputs),
        requiredDefinition,
      ),
    ),
  ];
  const slots = frames.filter((frame): frame is NeiPositionedSlot => Boolean(frame.resource));

  const canvas = growCanvas(definition.canvas ?? DEFAULT_CANVAS, frames);

  return {
    id: definition.id,
    canvas,
    slotSize: SLOT_SIZE,
    frames,
    slots,
    progressBars: definition.progressBars ?? DEFAULT_PROGRESS_BARS,
    logo: definition.logo ?? { x: 152, y: 63 },
  };
}

function resolveLayoutDefinition(recipeMap: string, recipe: Recipe): RecipeMapLayoutDefinition {
  const exportedGrid = exportedGridLayout(recipe);
  if (exportedGrid) {
    return exportedGrid;
  }

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
      progressBars: DEFAULT_PROGRESS_BARS,
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
      progressBars: DEFAULT_PROGRESS_BARS,
    };
  }

  return {
    id: "default",
  };
}

function exportedGridLayout(recipe: Recipe): RecipeMapLayoutDefinition | undefined {
  const nei = recipe.nei;
  if (
    !nei?.itemInputGrid &&
    !nei?.itemOutputGrid &&
    !nei?.fluidInputGrid &&
    !nei?.fluidOutputGrid
  ) {
    return undefined;
  }

  const itemInputWidth = nei.itemInputGrid?.width ?? 0;
  const itemInputHeight = nei.itemInputGrid?.height ?? 0;
  const itemOutputWidth = nei.itemOutputGrid?.width ?? 0;
  const itemOutputHeight = nei.itemOutputGrid?.height ?? 0;
  const fluidInputWidth = nei.fluidInputGrid?.width ?? 0;
  const fluidInputHeight = nei.fluidInputGrid?.height ?? 0;
  const fluidOutputWidth = nei.fluidOutputGrid?.width ?? 0;
  const fluidOutputHeight = nei.fluidOutputGrid?.height ?? 0;
  const inputItemRows = Math.max(itemInputHeight, itemOutputHeight);
  const outputItemRows = inputItemRows;

  return {
    id: "exported-nei-grid",
    maxItemInputs: itemInputWidth * itemInputHeight,
    maxItemOutputs: itemOutputWidth * itemOutputHeight,
    maxFluidInputs: fluidInputWidth * fluidInputHeight,
    maxFluidOutputs: fluidOutputWidth * fluidOutputHeight,
    logo: { x: 80, y: 62 },
    canvas: largeCanvas(
      itemInputWidth * itemInputHeight,
      itemOutputWidth * itemOutputHeight,
      fluidInputWidth * fluidInputHeight,
      fluidOutputWidth * fluidOutputHeight,
    ),
    itemInputPositions: (count) =>
      fixedOrGrowingGrid(count, 16, 8, Math.max(itemInputWidth, 1), itemInputHeight),
    itemOutputPositions: (count) =>
      fixedOrGrowingGrid(count, 106, 8, Math.max(itemOutputWidth, 1), itemOutputHeight),
    fluidInputPositions: (count) =>
      fixedOrGrowingGrid(
        count,
        16,
        8 + inputItemRows * SLOT_SIZE,
        Math.max(fluidInputWidth, 1),
        fluidInputHeight,
      ),
    fluidOutputPositions: (count) =>
      fixedOrGrowingGrid(
        count,
        106,
        8 + outputItemRows * SLOT_SIZE,
        Math.max(fluidOutputWidth, 1),
        fluidOutputHeight,
      ),
    progressBars: DEFAULT_PROGRESS_BARS,
  };
}

function fixedOrGrowingGrid(
  count: number,
  xOrigin: number,
  yOrigin: number,
  width: number,
  declaredHeight: number,
) {
  const rowsNeeded = count > 0 ? Math.ceil(count / Math.max(width, 1)) : 0;
  return gridPositions(
    count,
    xOrigin,
    yOrigin,
    Math.max(width, 1),
    Math.max(declaredHeight, rowsNeeded),
  );
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

function positionFrames(
  resources: Array<{ resource: ResourceAmount; resourceIndex: number }>,
  side: NeiSlotSide,
  kind: ResourceKind,
  positions: NeiPoint[],
): NeiSlotFrame[] {
  return positions.map((position, index) => ({
    side,
    kind,
    resource: resources[index]?.resource,
    resourceIndex: resources[index]?.resourceIndex,
    slotIndex: index,
    x: position.x,
    y: position.y,
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

function growCanvas(canvas: NeiSize, frames: NeiSlotFrame[]): NeiSize {
  const maxSlotBottom = Math.max(0, ...frames.map((frame) => frame.y + SLOT_SIZE + 2));
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
