import {
  getChanceMultiplier,
  isRecipeInputConsumed,
  makeResourceKey,
  primaryOutput,
  resourceLabel,
} from "../model/resources";
import type {
  BottleneckReport,
  EdgeThroughput,
  FactoryStorage,
  FactoryProject,
  FuelEstimate,
  NodeThroughputResult,
  Recipe,
  RecipeOutput,
  ResourceAmount,
  ResourceBalance,
  ResourceFlow,
  ResourceKey,
  ResourceKind,
  StorageThroughputResult,
  ThroughputResult,
} from "../model/types";
import { TICKS_PER_SECOND } from "../model/types";
import { getOverclockedRecipeStats } from "./overclock";

const EPSILON = 0.000001;

interface SolverOptions {
  generatedAt?: string;
}

type FlowRecord = Record<ResourceKey, ResourceFlow>;

export function calculateThroughput(
  project: FactoryProject,
  options: SolverOptions = {},
): ThroughputResult {
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const nodes: Record<string, NodeThroughputResult> = {};
  const storages: Record<string, StorageThroughputResult> = {};
  const balances = new Map<ResourceKey, ResourceBalance>();
  const bottlenecks: BottleneckReport[] = [];
  let totalEuT = 0;
  const projectStorages = project.storages ?? [];
  const storagesById = new Map(projectStorages.map((storage) => [storage.id, storage]));

  for (const storage of projectStorages) {
    storages[storage.id] = {
      storageId: storage.id,
      kind: storage.kind,
      resourceId: storage.resourceId,
      displayName: storage.displayName,
      storedAmount: 0,
      capacity: storage.capacity ?? getDefaultStorageCapacity(storage),
      producedPerSecond: 0,
      consumedPerSecond: 0,
      netPerSecond: 0,
      status: "empty",
    };
  }

  for (const node of project.nodes) {
    const recipe = recipesById.get(node.recipeId);

    if (!recipe) {
      nodes[node.id] = {
        nodeId: node.id,
        recipeId: node.recipeId,
        recipeName: "Missing recipe",
        enabled: node.enabled,
        operationRatePerSecond: 0,
        inputs: {},
        outputs: {},
        euT: 0,
        requiredRatePerSecond: 0,
        maxRatePerSecond: 0,
        utilization: 0,
        theoreticalMachinesRequired: 0,
        status: "missing-recipe",
        warnings: [`Recipe "${node.recipeId}" does not exist.`],
      };
      bottlenecks.push({
        id: `missing-recipe:${node.id}`,
        kind: "missing-recipe",
        severity: "critical",
        message: `Node ${node.id} references missing recipe ${node.recipeId}.`,
        nodeId: node.id,
      });
      continue;
    }

    if (!node.enabled) {
      nodes[node.id] = buildDisabledNodeResult(node.id, recipe);
      continue;
    }

    const overclockedRecipe = getOverclockedRecipeStats(recipe, node);
    const operationRatePerSecond =
      (node.machineCount * node.parallel * TICKS_PER_SECOND) / overclockedRecipe.durationTicks;
    const inputs: FlowRecord = {};
    const outputs: FlowRecord = {};

    for (const input of recipe.inputs) {
      if (!isRecipeInputConsumed(input)) {
        continue;
      }

      const amountPerSecond = input.amount * operationRatePerSecond;
      addFlow(inputs, input, amountPerSecond);
      addBalanceConsumption(balances, input, amountPerSecond);
    }

    for (const output of recipe.outputs) {
      const amountPerSecond = output.amount * getChanceMultiplier(output) * operationRatePerSecond;
      addFlow(outputs, output, amountPerSecond);
      addBalanceProduction(balances, output, amountPerSecond);
    }

    const euT = overclockedRecipe.eut * node.machineCount * node.parallel;
    totalEuT += euT;

    nodes[node.id] = {
      nodeId: node.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      enabled: true,
      operationRatePerSecond,
      inputs,
      outputs,
      euT,
      requiredRatePerSecond: 0,
      maxRatePerSecond: 0,
      utilization: 0,
      theoreticalMachinesRequired: 0,
      status: "underutilized",
      warnings: [],
    };
  }

  const incomingEdgeCounts = countIncomingEdgesByTargetResource(project);
  const requiredByNodeAndResource = new Map<string, Map<ResourceKey, number>>();
  const edgeResults: Record<string, EdgeThroughput> = {};
  const storageOutgoingDemand = calculateStorageOutgoingDemand(project, nodes, projectStorages);
  const storageIncomingCounts = countIncomingEdgesToStorage(project, projectStorages);
  const storageIncomingTransferred = new Map<string, number>();

  for (const edge of project.edges) {
    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    const sourceStorage = storagesById.get(edge.source);
    const targetStorage = storagesById.get(edge.target);

    if (sourceStorage || targetStorage) {
      if (sourceStorage && targetStorage) {
        continue;
      }

      if (targetStorage) {
        const sourceResult = nodes[edge.source];
        const countKey = `${targetStorage.id}|${key}`;
        const targetDemand = storageOutgoingDemand.get(countKey) ?? 0;
        const targetCount = storageIncomingCounts.get(countKey) ?? 1;
        const sourceCapacity = sourceResult?.outputs[key]?.amountPerSecond ?? 0;
        const demandPerSecond =
          edge.ratePerSecond ??
          (targetDemand > EPSILON ? targetDemand / targetCount : sourceCapacity);
        const transferredPerSecond = Math.min(sourceCapacity, demandPerSecond);

        addRequiredRate(requiredByNodeAndResource, edge.source, key, demandPerSecond);
        storageIncomingTransferred.set(
          countKey,
          (storageIncomingTransferred.get(countKey) ?? 0) + transferredPerSecond,
        );
        updateStorageFlow(storages[targetStorage.id], transferredPerSecond, 0);
        edgeResults[edge.id] = buildEdgeResult(edge, key, demandPerSecond, transferredPerSecond);
        continue;
      }

      if (sourceStorage) {
        const targetResult = nodes[edge.target];
        const targetCount = incomingEdgeCounts.get(`${edge.target}|${key}`) ?? 1;
        const targetDemand = targetResult?.inputs[key]?.amountPerSecond ?? 0;
        const demandPerSecond = edge.ratePerSecond ?? targetDemand / targetCount;
        const transferredPerSecond = demandPerSecond;

        updateStorageFlow(storages[sourceStorage.id], 0, transferredPerSecond);
        edgeResults[edge.id] = buildEdgeResult(edge, key, demandPerSecond, transferredPerSecond);
        continue;
      }
    }

    const sourceResult = nodes[edge.source];
    const targetResult = nodes[edge.target];
    const targetCount = incomingEdgeCounts.get(`${edge.target}|${key}`) ?? 1;
    const targetDemand = targetResult?.inputs[key]?.amountPerSecond ?? 0;
    const demandPerSecond = edge.ratePerSecond ?? targetDemand / targetCount;
    const sourceCapacity = sourceResult?.outputs[key]?.amountPerSecond ?? 0;
    const transferredPerSecond = Math.min(sourceCapacity, demandPerSecond);

    addRequiredRate(requiredByNodeAndResource, edge.source, key, demandPerSecond);

    edgeResults[edge.id] = buildEdgeResult(edge, key, demandPerSecond, transferredPerSecond);
  }

  aggregateStorageFlowsByResource(projectStorages, storages);

  for (const storageResult of Object.values(storages)) {
    finalizeStorageFlow(storageResult);
  }

  applyProjectTarget(project, nodes, requiredByNodeAndResource);

  for (const node of project.nodes) {
    const nodeResult = nodes[node.id];
    const recipe = recipesById.get(node.recipeId);

    if (!nodeResult || !recipe || nodeResult.status === "missing-recipe") {
      continue;
    }

    if (!node.enabled) {
      continue;
    }

    const requiredByResource = new Map(requiredByNodeAndResource.get(node.id));

    if (node.targetOutput) {
      const targetKey = makeResourceKey(node.targetOutput.kind, node.targetOutput.resourceId);
      const previous = requiredByResource.get(targetKey) ?? 0;
      requiredByResource.set(targetKey, Math.max(previous, node.targetOutput.amountPerSecond));
    }

    const outputFlows = Object.values(nodeResult.outputs);
    if (requiredByResource.size === 0 && outputFlows.length > 0) {
      const output = primaryOutput(recipe);
      if (output) {
        const key = makeResourceKey(output.kind, output.id);
        requiredByResource.set(key, nodeResult.outputs[key]?.amountPerSecond ?? 0);
      }
    }

    const overclockedRecipe = {
      ...recipe,
      ...getOverclockedRecipeStats(recipe, node),
    };
    const utilizationReport = selectLimitingOutput(
      overclockedRecipe,
      node,
      nodeResult,
      requiredByResource,
    );
    nodeResult.requiredRatePerSecond = utilizationReport.requiredRatePerSecond;
    nodeResult.maxRatePerSecond = utilizationReport.maxRatePerSecond;
    nodeResult.utilization = utilizationReport.utilization;
    nodeResult.theoreticalMachinesRequired = utilizationReport.theoreticalMachinesRequired;
    nodeResult.limitingResource = utilizationReport.limitingResource;
    nodeResult.status = getNodeStatus(nodeResult.utilization);

    if (nodeResult.status === "bottleneck") {
      bottlenecks.push({
        id: `node-capacity:${node.id}`,
        kind: "node-capacity",
        severity: "critical",
        message: `${recipe.name} needs ${utilizationReport.requiredRatePerSecond.toFixed(
          2,
        )}/s but can produce ${utilizationReport.maxRatePerSecond.toFixed(2)}/s.`,
        nodeId: node.id,
        resource: utilizationReport.limitingResource,
        requiredPerSecond: utilizationReport.requiredRatePerSecond,
        capacityPerSecond: utilizationReport.maxRatePerSecond,
      });
    }
  }

  const resourceResults = Object.fromEntries(balances) as Record<ResourceKey, ResourceBalance>;
  const externalInputs = Object.values(resourceResults)
    .filter((balance) => balance.deficitPerSecond > EPSILON)
    .sort((a, b) => b.deficitPerSecond - a.deficitPerSecond);
  const unconsumedOutputs = Object.values(resourceResults)
    .filter((balance) => balance.surplusPerSecond > EPSILON)
    .sort((a, b) => b.surplusPerSecond - a.surplusPerSecond);

  for (const balance of externalInputs) {
    bottlenecks.push({
      id: `resource-deficit:${balance.key}`,
      kind: "resource-deficit",
      severity: "critical",
      message: `${balance.displayName ?? balance.resourceId} is short by ${balance.deficitPerSecond.toFixed(
        2,
      )}/s.`,
      resource: {
        key: balance.key,
        kind: balance.kind,
        resourceId: balance.resourceId,
        displayName: balance.displayName,
        amountPerSecond: balance.deficitPerSecond,
      },
      requiredPerSecond: balance.consumedPerSecond,
      capacityPerSecond: balance.producedPerSecond,
    });
  }

  return {
    nodes,
    storages,
    resources: resourceResults,
    edges: edgeResults,
    totalEuT,
    totalEuPerSecond: totalEuT * TICKS_PER_SECOND,
    fuelEstimate: calculateFuelEstimate(project, totalEuT),
    bottlenecks,
    externalInputs,
    unconsumedOutputs,
    generatedAt: options.generatedAt ?? project.metadata?.updatedAt ?? "unspecified",
  };
}

function buildDisabledNodeResult(nodeId: string, recipe: Recipe): NodeThroughputResult {
  return {
    nodeId,
    recipeId: recipe.id,
    recipeName: recipe.name,
    enabled: false,
    operationRatePerSecond: 0,
    inputs: {},
    outputs: {},
    euT: 0,
    requiredRatePerSecond: 0,
    maxRatePerSecond: 0,
    utilization: 0,
    theoreticalMachinesRequired: 0,
    status: "disabled",
    warnings: [],
  };
}

function addFlow(record: FlowRecord, resource: ResourceAmount, amountPerSecond: number): void {
  const key = makeResourceKey(resource.kind, resource.id);
  const existing = record[key];

  record[key] = {
    key,
    kind: resource.kind,
    resourceId: resource.id,
    displayName: resource.displayName,
    amountPerSecond: (existing?.amountPerSecond ?? 0) + amountPerSecond,
  };
}

function ensureBalance(
  balances: Map<ResourceKey, ResourceBalance>,
  resource: ResourceAmount,
): ResourceBalance {
  const key = makeResourceKey(resource.kind, resource.id);
  const existing = balances.get(key);

  if (existing) {
    return existing;
  }

  const balance: ResourceBalance = {
    key,
    kind: resource.kind,
    resourceId: resource.id,
    displayName: resource.displayName,
    producedPerSecond: 0,
    consumedPerSecond: 0,
    netPerSecond: 0,
    surplusPerSecond: 0,
    deficitPerSecond: 0,
  };
  balances.set(key, balance);
  return balance;
}

function addBalanceProduction(
  balances: Map<ResourceKey, ResourceBalance>,
  resource: ResourceAmount,
  amountPerSecond: number,
): void {
  const balance = ensureBalance(balances, resource);
  balance.producedPerSecond += amountPerSecond;
  updateBalanceNet(balance);
}

function addBalanceConsumption(
  balances: Map<ResourceKey, ResourceBalance>,
  resource: ResourceAmount,
  amountPerSecond: number,
): void {
  const balance = ensureBalance(balances, resource);
  balance.consumedPerSecond += amountPerSecond;
  updateBalanceNet(balance);
}

function updateBalanceNet(balance: ResourceBalance): void {
  balance.netPerSecond = balance.producedPerSecond - balance.consumedPerSecond;
  balance.surplusPerSecond = Math.max(0, balance.netPerSecond);
  balance.deficitPerSecond = Math.max(0, -balance.netPerSecond);
}

function countIncomingEdgesByTargetResource(project: FactoryProject): Map<string, number> {
  const counts = new Map<string, number>();

  for (const edge of project.edges) {
    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    const countKey = `${edge.target}|${key}`;
    counts.set(countKey, (counts.get(countKey) ?? 0) + 1);
  }

  return counts;
}

function countIncomingEdgesToStorage(
  project: FactoryProject,
  storages: FactoryStorage[],
): Map<string, number> {
  const storageIds = new Set(storages.map((storage) => storage.id));
  const counts = new Map<string, number>();

  for (const edge of project.edges) {
    if (!storageIds.has(edge.target)) {
      continue;
    }

    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    const countKey = `${edge.target}|${key}`;
    counts.set(countKey, (counts.get(countKey) ?? 0) + 1);
  }

  return counts;
}

function calculateStorageOutgoingDemand(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  storages: FactoryStorage[],
): Map<string, number> {
  const storageIds = new Set(storages.map((storage) => storage.id));
  const demand = new Map<string, number>();
  const incomingEdgeCounts = countIncomingEdgesByTargetResource(project);

  for (const edge of project.edges) {
    if (!storageIds.has(edge.source)) {
      continue;
    }

    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    const targetResult = nodes[edge.target];
    const targetCount = incomingEdgeCounts.get(`${edge.target}|${key}`) ?? 1;
    const targetDemand = targetResult?.inputs[key]?.amountPerSecond ?? 0;
    const demandPerSecond = edge.ratePerSecond ?? targetDemand / targetCount;
    const countKey = `${edge.source}|${key}`;
    demand.set(countKey, (demand.get(countKey) ?? 0) + demandPerSecond);
  }

  return demand;
}

function buildEdgeResult(
  edge: { id: string; resourceKind: ResourceKind; resourceId: string; label?: string },
  key: ResourceKey,
  demandPerSecond: number,
  transferredPerSecond: number,
): EdgeThroughput {
  return {
    edgeId: edge.id,
    resource: {
      key,
      kind: edge.resourceKind,
      resourceId: edge.resourceId,
      displayName: edge.label,
      amountPerSecond: transferredPerSecond,
    },
    demandPerSecond,
    transferredPerSecond,
    isLimited: transferredPerSecond + EPSILON < demandPerSecond,
  };
}

function getDefaultStorageCapacity(storage: FactoryStorage): number {
  return storage.kind === "fluid" ? 4_000_000 : 262_144;
}

function updateStorageFlow(
  storage: StorageThroughputResult | undefined,
  producedPerSecond: number,
  consumedPerSecond: number,
) {
  if (!storage) {
    return;
  }

  storage.producedPerSecond += producedPerSecond;
  storage.consumedPerSecond += consumedPerSecond;
}

function aggregateStorageFlowsByResource(
  projectStorages: FactoryStorage[],
  storages: Record<string, StorageThroughputResult>,
) {
  const aggregateByResource = new Map<
    ResourceKey,
    Pick<
      StorageThroughputResult,
      "capacity" | "producedPerSecond" | "consumedPerSecond" | "netPerSecond" | "storedAmount"
    >
  >();

  for (const storage of projectStorages) {
    const result = storages[storage.id];
    if (!result) {
      continue;
    }

    const key = makeResourceKey(storage.kind, storage.resourceId);
    const aggregate = aggregateByResource.get(key);
    if (aggregate) {
      aggregate.capacity += result.capacity;
      aggregate.producedPerSecond += result.producedPerSecond;
      aggregate.consumedPerSecond += result.consumedPerSecond;
    } else {
      aggregateByResource.set(key, {
        capacity: result.capacity,
        producedPerSecond: result.producedPerSecond,
        consumedPerSecond: result.consumedPerSecond,
        netPerSecond: 0,
        storedAmount: 0,
      });
    }
  }

  for (const aggregate of aggregateByResource.values()) {
    aggregate.netPerSecond = aggregate.producedPerSecond - aggregate.consumedPerSecond;
    aggregate.storedAmount = Math.max(0, Math.min(aggregate.capacity, aggregate.netPerSecond));
  }

  for (const storage of projectStorages) {
    const result = storages[storage.id];
    const aggregate = aggregateByResource.get(makeResourceKey(storage.kind, storage.resourceId));
    if (!result || !aggregate) {
      continue;
    }

    result.capacity = aggregate.capacity;
    result.producedPerSecond = aggregate.producedPerSecond;
    result.consumedPerSecond = aggregate.consumedPerSecond;
    result.netPerSecond = aggregate.netPerSecond;
    result.storedAmount = aggregate.storedAmount;
  }
}

function finalizeStorageFlow(storage: StorageThroughputResult) {
  storage.netPerSecond = storage.producedPerSecond - storage.consumedPerSecond;
  storage.storedAmount = Math.max(0, Math.min(storage.capacity, storage.netPerSecond));

  if (storage.producedPerSecond <= EPSILON && storage.consumedPerSecond <= EPSILON) {
    storage.status = "empty";
  } else if (Math.abs(storage.netPerSecond) <= EPSILON) {
    storage.status = "balanced";
  } else if (storage.netPerSecond > 0) {
    storage.status = "filling";
  } else {
    storage.status = "draining";
  }
}

function addRequiredRate(
  requiredByNodeAndResource: Map<string, Map<ResourceKey, number>>,
  nodeId: string,
  resourceKey: ResourceKey,
  amountPerSecond: number,
): void {
  const nodeRequirements = requiredByNodeAndResource.get(nodeId) ?? new Map<ResourceKey, number>();
  nodeRequirements.set(resourceKey, (nodeRequirements.get(resourceKey) ?? 0) + amountPerSecond);
  requiredByNodeAndResource.set(nodeId, nodeRequirements);
}

function applyProjectTarget(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  requiredByNodeAndResource: Map<string, Map<ResourceKey, number>>,
): void {
  if (!project.targetRate) {
    return;
  }

  const targetKey = makeResourceKey(project.targetRate.kind, project.targetRate.resourceId);
  const producers = project.nodes.filter((node) => nodes[node.id]?.outputs[targetKey]);

  if (producers.length === 0) {
    return;
  }

  const nodesWithNoOutgoingTargetEdge = producers.filter(
    (node) =>
      !project.edges.some(
        (edge) =>
          edge.source === node.id &&
          makeResourceKey(edge.resourceKind, edge.resourceId) === targetKey,
      ),
  );
  const targetNodes =
    nodesWithNoOutgoingTargetEdge.length > 0 ? nodesWithNoOutgoingTargetEdge : producers;
  const targetShare = project.targetRate.amountPerSecond / targetNodes.length;

  for (const node of targetNodes) {
    addRequiredRate(requiredByNodeAndResource, node.id, targetKey, targetShare);
  }
}

function selectLimitingOutput(
  recipe: Recipe,
  node: { parallel: number; machineCount: number },
  nodeResult: NodeThroughputResult,
  requiredByResource: Map<ResourceKey, number>,
): {
  requiredRatePerSecond: number;
  maxRatePerSecond: number;
  utilization: number;
  theoreticalMachinesRequired: number;
  limitingResource?: ResourceFlow;
} {
  let best = {
    requiredRatePerSecond: 0,
    maxRatePerSecond: 0,
    utilization: 0,
    theoreticalMachinesRequired: 0,
    limitingResource: undefined as ResourceFlow | undefined,
  };

  for (const [resourceKey, requiredRatePerSecond] of requiredByResource) {
    const outputFlow = nodeResult.outputs[resourceKey];
    if (!outputFlow) {
      continue;
    }

    const utilization =
      outputFlow.amountPerSecond > EPSILON
        ? requiredRatePerSecond / outputFlow.amountPerSecond
        : requiredRatePerSecond > EPSILON
          ? Number.POSITIVE_INFINITY
          : 0;

    if (utilization >= best.utilization) {
      const recipeOutput = findRecipeOutputByKey(recipe.outputs, resourceKey);
      best = {
        requiredRatePerSecond,
        maxRatePerSecond: outputFlow.amountPerSecond,
        utilization,
        theoreticalMachinesRequired: calculateTheoreticalMachines(
          recipe,
          node.parallel,
          requiredRatePerSecond,
          recipeOutput,
        ),
        limitingResource: {
          ...outputFlow,
          amountPerSecond: requiredRatePerSecond,
        },
      };
    }
  }

  if (!best.limitingResource) {
    const output = primaryOutput(recipe);
    if (!output) {
      return best;
    }

    const key = makeResourceKey(output.kind, output.id);
    const outputFlow = nodeResult.outputs[key];
    if (!outputFlow) {
      return best;
    }

    best = {
      requiredRatePerSecond: outputFlow.amountPerSecond,
      maxRatePerSecond: outputFlow.amountPerSecond,
      utilization: outputFlow.amountPerSecond > EPSILON ? 1 : 0,
      theoreticalMachinesRequired: node.machineCount,
      limitingResource: outputFlow,
    };
  }

  return best;
}

function findRecipeOutputByKey(
  outputs: RecipeOutput[],
  resourceKey: ResourceKey,
): RecipeOutput | undefined {
  return outputs.find((output) => makeResourceKey(output.kind, output.id) === resourceKey);
}

function calculateTheoreticalMachines(
  recipe: Recipe,
  parallel: number,
  requiredRatePerSecond: number,
  output: RecipeOutput | undefined,
): number {
  if (!output) {
    return 0;
  }

  const outputPerMachineSecond =
    (output.amount * getChanceMultiplier(output) * parallel * TICKS_PER_SECOND) /
    recipe.durationTicks;

  if (outputPerMachineSecond <= EPSILON) {
    return Number.POSITIVE_INFINITY;
  }

  return requiredRatePerSecond / outputPerMachineSecond;
}

function getNodeStatus(utilization: number): NodeThroughputResult["status"] {
  if (utilization > 1 + EPSILON) {
    return "bottleneck";
  }

  if (utilization >= 0.9 && utilization <= 1 + EPSILON) {
    return "balanced";
  }

  return "underutilized";
}

function calculateFuelEstimate(
  project: FactoryProject,
  totalEuT: number,
): FuelEstimate | undefined {
  const selectedFuel = project.fuelProfiles.find(
    (fuel) => fuel.id === project.selectedFuelProfileId,
  );

  if (!selectedFuel) {
    return undefined;
  }

  const totalEuPerSecond = totalEuT * TICKS_PER_SECOND;

  if (selectedFuel.euPerLiter) {
    return {
      fuelProfile: selectedFuel,
      totalEuPerSecond,
      fuelPerSecond: totalEuPerSecond / selectedFuel.euPerLiter,
      unit: "L/s",
    };
  }

  if (selectedFuel.euPerBucket) {
    return {
      fuelProfile: selectedFuel,
      totalEuPerSecond,
      fuelPerSecond: totalEuPerSecond / selectedFuel.euPerBucket,
      unit: "buckets/s",
    };
  }

  return undefined;
}

export function getResourceDisplayName(
  kind: ResourceKind,
  resourceId: string,
  project: FactoryProject,
): string {
  for (const recipe of project.recipes) {
    const resource = [...recipe.inputs, ...recipe.outputs].find(
      (entry) => entry.kind === kind && entry.id === resourceId,
    );
    if (resource) {
      return resourceLabel(resource);
    }
  }

  return resourceId;
}
