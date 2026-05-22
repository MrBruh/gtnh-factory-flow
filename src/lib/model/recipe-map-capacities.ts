export interface RecipeMapSlotCapacity {
  maxItemInputs?: number;
  maxItemOutputs?: number;
  maxFluidInputs?: number;
  maxFluidOutputs?: number;
}

const GT_RECIPE_MAP_SLOT_CAPACITIES: Array<{
  patterns: string[];
  capacity: RecipeMapSlotCapacity;
}> = [
  { patterns: ["alloysmelter", "alloy smelter"], capacity: maxIO(2, 1, 0, 0) },
  { patterns: ["amplifier", "matter amplifier", "uuamplifier"], capacity: maxIO(1, 0, 0, 1) },
  { patterns: ["arcfurnace", "arc furnace"], capacity: maxIO(2, 9, 2, 1) },
  { patterns: ["assembler"], capacity: maxIO(9, 1, 1, 0) },
  { patterns: ["autoclave"], capacity: maxIO(2, 4, 1, 1) },
  { patterns: ["bender", "bending machine", "metalbender"], capacity: maxIO(2, 1, 0, 0) },
  { patterns: ["blastfurnace", "blast furnace"], capacity: maxIO(6, 6, 1, 1) },
  { patterns: ["brewer", "brewery"], capacity: maxIO(1, 0, 1, 1) },
  { patterns: ["canner", "fluid canner"], capacity: maxIO(2, 2, 1, 1) },
  { patterns: ["centrifuge"], capacity: maxIO(2, 6, 1, 1) },
  { patterns: ["chemicalbath", "chemical bath"], capacity: maxIO(2, 3, 2, 2) },
  { patterns: ["chemicalplant", "chemical plant"], capacity: maxIO(4, 6, 4, 3) },
  { patterns: ["chemicalreactor", "chemical reactor"], capacity: maxIO(2, 2, 1, 1) },
  { patterns: ["circuitassembler", "circuit assembler"], capacity: maxIO(6, 1, 1, 0) },
  { patterns: ["cokeoven", "coke oven"], capacity: maxIO(1, 1, 0, 1) },
  { patterns: ["compressor"], capacity: maxIO(1, 1, 1, 0) },
  { patterns: ["cuttingsaw", "cutting machine", "cutter"], capacity: maxIO(2, 4, 1, 0) },
  { patterns: ["distillery"], capacity: maxIO(1, 1, 1, 1) },
  { patterns: ["distillationtower", "distillation tower"], capacity: maxIO(2, 1, 1, 11) },
  { patterns: ["electrolyzer"], capacity: maxIO(2, 6, 1, 1) },
  {
    patterns: ["electromagneticseparator", "electromagnetic separator"],
    capacity: maxIO(1, 3, 0, 0),
  },
  { patterns: ["entropicprocessing", "entropic processing"], capacity: maxIO(6, 6, 3, 3) },
  { patterns: ["extractor"], capacity: maxIO(1, 1, 0, 0) },
  { patterns: ["extruder"], capacity: maxIO(2, 1, 0, 0) },
  { patterns: ["fermenter", "fermenting"], capacity: maxIO(0, 0, 1, 1) },
  { patterns: ["fluidextractor", "fluid extractor"], capacity: maxIO(1, 1, 0, 1) },
  { patterns: ["fluidheater", "fluid heater"], capacity: maxIO(1, 1, 1, 1) },
  { patterns: ["fluidsolidifier", "fluid solidifier"], capacity: maxIO(1, 1, 1, 0) },
  { patterns: ["formingpress", "forming press", "press"], capacity: maxIO(6, 1, 1, 0) },
  { patterns: ["fusionreactor", "fusion reactor"], capacity: maxIO(0, 0, 2, 1) },
  { patterns: ["hammer", "forge hammer"], capacity: maxIO(2, 2, 2, 2) },
  { patterns: ["implosioncompressor", "implosion compressor"], capacity: maxIO(2, 2, 0, 0) },
  { patterns: ["largechemicalreactor", "large chemical reactor"], capacity: maxIO(6, 6, 6, 6) },
  { patterns: ["laserengraver", "laser engraver"], capacity: maxIO(4, 4, 2, 2) },
  { patterns: ["lathe"], capacity: maxIO(1, 2, 0, 0) },
  { patterns: ["macerator"], capacity: maxIO(1, 4, 0, 0) },
  { patterns: ["mixer"], capacity: maxIO(9, 4, 1, 1) },
  { patterns: ["nanoforge", "nano forge"], capacity: maxIO(6, 2, 3, 0) },
  { patterns: ["neutroniumcompressor", "neutronium compressor"], capacity: maxIO(1, 1, 1, 0) },
  { patterns: ["oilcracker", "oil cracker", "craker"], capacity: maxIO(1, 1, 2, 1) },
  { patterns: ["orewasher", "ore washer"], capacity: maxIO(1, 3, 1, 0) },
  { patterns: ["packager"], capacity: maxIO(2, 1, 0, 0) },
  { patterns: ["pcbfactory", "pcb factory"], capacity: maxIO(6, 9, 3, 0) },
  { patterns: ["plasmaforge", "plasma forge"], capacity: maxIO(9, 9, 9, 9) },
  { patterns: ["polarizer", "electromagnetic polarizer"], capacity: maxIO(1, 1, 0, 0) },
  { patterns: ["primitiveblastfurnace", "primitive blast furnace"], capacity: maxIO(3, 3, 0, 0) },
  { patterns: ["printer"], capacity: maxIO(1, 1, 1, 0) },
  { patterns: ["pyro", "pyrolyse oven", "pyrolyse"], capacity: maxIO(2, 1, 1, 1) },
  { patterns: ["replicator"], capacity: maxIO(0, 1, 1, 1) },
  { patterns: ["rockbreaker", "rock breaker"], capacity: maxIO(2, 1, 0, 0) },
  { patterns: ["scanner"], capacity: maxIO(1, 1, 1, 0) },
  { patterns: ["sifter"], capacity: maxIO(1, 9, 1, 1) },
  { patterns: ["thermalcentrifuge", "thermal centrifuge"], capacity: maxIO(1, 3, 0, 0) },
  { patterns: ["unpackager"], capacity: maxIO(1, 2, 0, 0) },
  { patterns: ["vacuumfreezer", "vacuum freezer"], capacity: maxIO(1, 1, 2, 1) },
  { patterns: ["wiremill"], capacity: maxIO(2, 1, 0, 0) },
  { patterns: ["zhuhai", "fishing port"], capacity: maxIO(1, 25, 0, 0) },
  {
    patterns: ["multiblockcentrifuge", "multiblock centrifuge"],
    capacity: maxIO(6, 6, 6, 6),
  },
  {
    patterns: ["multiblockelectrolyzer", "multiblock electrolyzer"],
    capacity: maxIO(6, 6, 6, 6),
  },
  {
    patterns: ["multiblockmixer", "multiblock mixer"],
    capacity: maxIO(6, 6, 6, 6),
  },
  {
    patterns: ["multiblockdehydrator", "multiblock dehydrator"],
    capacity: maxIO(6, 6, 6, 6),
  },
  {
    patterns: ["transcendentplasmamixer", "transcendent plasma mixer"],
    capacity: maxIO(1, 0, 20, 1),
  },
];

export function knownRecipeMapSlotCapacity(recipeMap: string): RecipeMapSlotCapacity | undefined {
  const normalized = normalizeRecipeMapName(recipeMap);
  return GT_RECIPE_MAP_SLOT_CAPACITIES.flatMap((entry) =>
    entry.patterns.map((pattern) => ({
      capacity: entry.capacity,
      pattern: normalizeRecipeMapName(pattern),
    })),
  )
    .filter((entry) => normalized.includes(entry.pattern))
    .sort((left, right) => right.pattern.length - left.pattern.length)[0]?.capacity;
}

export function mergeRecipeMapSlotCapacity(
  left: RecipeMapSlotCapacity | undefined,
  right: RecipeMapSlotCapacity | undefined,
): RecipeMapSlotCapacity {
  return compactSlotCapacity({
    maxItemInputs: maxOptional(left?.maxItemInputs, right?.maxItemInputs),
    maxItemOutputs: maxOptional(left?.maxItemOutputs, right?.maxItemOutputs),
    maxFluidInputs: maxOptional(left?.maxFluidInputs, right?.maxFluidInputs),
    maxFluidOutputs: maxOptional(left?.maxFluidOutputs, right?.maxFluidOutputs),
  });
}

function maxIO(
  maxItemInputs: number,
  maxItemOutputs: number,
  maxFluidInputs: number,
  maxFluidOutputs: number,
): RecipeMapSlotCapacity {
  return compactSlotCapacity({ maxItemInputs, maxItemOutputs, maxFluidInputs, maxFluidOutputs });
}

function normalizeRecipeMapName(recipeMap: string): string {
  return recipeMap
    .toLowerCase()
    .replace(/\b(recipes?|recipe map|map)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function compactSlotCapacity(capacity: RecipeMapSlotCapacity): RecipeMapSlotCapacity {
  return Object.fromEntries(
    Object.entries(capacity).filter(([, value]) => typeof value === "number" && value > 0),
  ) as RecipeMapSlotCapacity;
}

function maxOptional(left?: number, right?: number): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}
