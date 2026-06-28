import { calculateThroughput } from "../solver";
import type {
  FactoryProject,
  ResolvedMachine,
  ResolvedNet,
  ResolvedPlan,
  ResolvedResourceRate,
  ResourceFlow,
  ResourceKey,
} from "../model/types";

/** Identifies the producer of an exported plan in its `app` provenance block. */
export const APP_NAME = "gtnh-factory-flow";

/**
 * Pick the dataset version to surface at the top of the export, taken from the
 * recipes' `source.datasetVersionId` (the most common one wins). Lets a consumer
 * pin the recipe-dataset version without scanning every recipe.
 */
export function deriveDatasetVersionId(project: FactoryProject): string | undefined {
  const counts = new Map<string, number>();
  for (const recipe of project.recipes) {
    const id = recipe.source?.datasetVersionId;
    if (id) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  let best: string | undefined;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }

  return best;
}

/**
 * Project the throughput solver's result into the solver-facing `resolved` block:
 * per-machine EU/t and nameplate flows, per-net transferred rates, external I/O,
 * and a power summary. This is the authoritative balance so downstream consumers
 * don't re-implement throughput math.
 */
export function buildResolvedPlan(
  project: FactoryProject,
  options: { generatedAt?: string } = {},
): ResolvedPlan {
  const result = calculateThroughput(project, { generatedAt: options.generatedAt });
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));

  const machines: ResolvedMachine[] = [];
  for (const node of project.nodes) {
    const nodeResult = result.nodes[node.id];
    if (!nodeResult || !nodeResult.enabled || nodeResult.status === "missing-recipe") {
      continue;
    }

    const recipe = recipesById.get(node.recipeId);
    const machineType = recipe?.machineType ?? nodeResult.recipeName;
    machines.push({
      nodeId: node.id,
      machineKey: recipe?.source?.recipeMap ?? machineType,
      machineType,
      tier: node.overclockTier,
      machineCount: node.machineCount,
      parallel: node.parallel,
      eutPerMachine: node.machineCount > 0 ? nodeResult.euT / node.machineCount : nodeResult.euT,
      totalEut: nodeResult.euT,
      inputs: toRates(nodeResult.inputs),
      outputs: toRates(nodeResult.outputs),
    });
  }

  const nets: ResolvedNet[] = project.edges.map((edge) => ({
    edgeId: edge.id,
    from: edge.source,
    to: edge.target,
    kind: edge.resourceKind,
    id: edge.resourceId,
    perSecond: result.edges[edge.id]?.transferredPerSecond ?? 0,
  }));

  return {
    generatedAt: result.generatedAt,
    machines,
    nets,
    externalIO: {
      inputs: result.externalInputs.map((balance) => ({
        kind: balance.kind,
        id: balance.resourceId,
        perSecond: balance.deficitPerSecond,
      })),
      outputs: result.unconsumedOutputs.map((balance) => ({
        kind: balance.kind,
        id: balance.resourceId,
        perSecond: balance.surplusPerSecond,
      })),
    },
    power: {
      totalEut: result.totalEuT,
      totalEuPerSecond: result.totalEuPerSecond,
      fuel: result.fuelEstimate?.fuelProfile.id,
      fuelPerSecond: result.fuelEstimate?.fuelPerSecond,
      fuelUnit: result.fuelEstimate?.unit,
    },
  };
}

function toRates(flows: Record<ResourceKey, ResourceFlow>): ResolvedResourceRate[] {
  return Object.values(flows).map((flow) => ({
    kind: flow.kind,
    id: flow.resourceId,
    perSecond: flow.amountPerSecond,
  }));
}
