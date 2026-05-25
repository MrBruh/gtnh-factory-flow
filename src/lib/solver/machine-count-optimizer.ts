import { applyRecipeInputOverrides } from "@/lib/model/recipe-input-overrides";
import { applyMachineHandlerToRecipe } from "@/lib/model/recipe-rules";
import {
  getChanceMultiplier,
  isRecipeInputConsumed,
  makeResourceKey,
  resourceMatchesInput,
} from "@/lib/model/resources";
import type {
  FactoryEdge,
  FactoryNode,
  FactoryProject,
  FactoryStorage,
  Recipe,
  ResourceAmount,
  ResourceKey,
} from "@/lib/model/types";
import { TICKS_PER_SECOND } from "@/lib/model/types";
import { getOverclockedRecipeStats } from "./overclock";
import { getMachineOutputMultiplier, getMachineParallelMultiplier } from "./machine-effects";

const EPSILON = 0.000001;
const STORAGE_BUS_PREFIX = "storage-bus:";

export interface MachineCountOptimizationResult {
  machineCounts: Map<string, number>;
  diagnostics: string[];
}

type EndpointId = string;

type RatePlan = {
  node: FactoryNode;
  recipe?: Recipe;
  effectiveRecipe?: Recipe;
  inputs: Map<ResourceKey, number>;
  outputs: Map<ResourceKey, number>;
  inputDefinitions: ResourceAmount[];
  enabled: boolean;
  valid: boolean;
};

type Supplier = {
  source: EndpointId;
  sourceNodeId?: string;
  sourceStorageBusId?: string;
  resourceKey: ResourceKey;
};

type StorageProducer = {
  nodeId: string;
  resourceKey: ResourceKey;
};

type ContributionLink = {
  childNodeId: string;
  childInputKey: ResourceKey;
  inputPerParentMachine: number;
};

type StorageContribution = {
  amountPerMachine: number;
  links: ContributionLink[];
};

type GraphContext = {
  project: FactoryProject;
  nodesById: Map<string, FactoryNode>;
  recipesById: Map<string, Recipe>;
  storagesById: Map<string, FactoryStorage>;
  storageResourceById: Map<string, ResourceKey>;
  ratePlans: Map<string, RatePlan>;
  adjacency: Map<EndpointId, EndpointId[]>;
  componentByEndpoint: Map<EndpointId, number>;
  cyclicComponents: Set<number>;
  incomingSuppliersByNodeResource: Map<string, Supplier[]>;
  storageProducersByResource: Map<ResourceKey, StorageProducer[]>;
  nodeToStorageEdges: Map<string, FactoryEdge[]>;
  nodeToNodeEdges: Map<string, FactoryEdge[]>;
  diagnostics: string[];
};

class MachineCountOptimizer {
  private readonly machineCounts = new Map<string, number>();
  private readonly operationDemand = new Map<string, number>();
  private readonly outputDemand = new Map<string, number>();
  private readonly storageCredits = new Map<ResourceKey, number>();
  private readonly contributionCache = new Map<string, StorageContribution>();

  constructor(private readonly context: GraphContext) {
    for (const node of context.project.nodes) {
      const plan = context.ratePlans.get(node.id);
      this.machineCounts.set(
        node.id,
        plan?.enabled && plan.valid ? 1 : normalizeMachineCount(node.machineCount),
      );
    }
  }

  optimize(): MachineCountOptimizationResult {
    let hasExplicitDemand = false;
    for (const node of this.context.project.nodes) {
      if (!node.targetOutput) {
        continue;
      }

      hasExplicitDemand = true;
      const key = makeResourceKey(node.targetOutput.kind, node.targetOutput.resourceId);
      this.requireNodeOutput(node.id, key, node.targetOutput.amountPerSecond, undefined);
    }

    if (this.context.project.targetRate) {
      hasExplicitDemand = true;
      const key = makeResourceKey(
        this.context.project.targetRate.kind,
        this.context.project.targetRate.resourceId,
      );
      this.satisfyLooseOutputDemand(key, this.context.project.targetRate.amountPerSecond);
    }

    if (!hasExplicitDemand) {
      this.seedImplicitTerminalDemands();
    }

    return {
      machineCounts: this.machineCounts,
      diagnostics: this.context.diagnostics,
    };
  }

  private seedImplicitTerminalDemands() {
    for (const node of this.context.project.nodes) {
      const plan = this.context.ratePlans.get(node.id);
      if (!plan?.enabled || !plan.valid || (this.context.adjacency.get(node.id) ?? []).length > 0) {
        continue;
      }

      this.ensureNodeOperations(node.id, normalizeMachineCount(node.machineCount), new Set());
    }
  }

  private satisfyLooseOutputDemand(resourceKey: ResourceKey, amountPerSecond: number) {
    if (amountPerSecond <= EPSILON) {
      return;
    }

    const candidates = [...this.context.ratePlans.values()]
      .filter(
        (plan) => plan.enabled && plan.valid && (plan.outputs.get(resourceKey) ?? 0) > EPSILON,
      )
      .filter((plan) => !this.hasOutgoingResourceEdge(plan.node.id, resourceKey));
    const usableCandidates =
      candidates.length > 0
        ? candidates
        : [...this.context.ratePlans.values()].filter(
            (plan) => plan.enabled && plan.valid && (plan.outputs.get(resourceKey) ?? 0) > EPSILON,
          );
    const candidate = usableCandidates
      .map((plan) => ({
        nodeId: plan.node.id,
        cost: this.estimateNodeOutputCost(plan.node.id, resourceKey, amountPerSecond, new Set()),
        outputRate: plan.outputs.get(resourceKey) ?? 0,
      }))
      .sort(compareCandidateScores)[0];

    if (!candidate || !Number.isFinite(candidate.cost)) {
      return;
    }

    this.requireNodeOutput(candidate.nodeId, resourceKey, amountPerSecond, undefined);
  }

  private hasOutgoingResourceEdge(nodeId: string, resourceKey: ResourceKey): boolean {
    return this.context.project.edges.some(
      (edge) =>
        edge.source === nodeId &&
        makeResourceKey(edge.resourceKind, edge.resourceId) === resourceKey,
    );
  }

  private requireNodeOutput(
    nodeId: string,
    resourceKey: ResourceKey,
    amountPerSecond: number,
    consumerEndpoint: EndpointId | undefined,
  ) {
    if (amountPerSecond <= EPSILON || this.isInternalCyclicDemand(nodeId, consumerEndpoint)) {
      return;
    }

    const plan = this.context.ratePlans.get(nodeId);
    const outputRate = plan?.outputs.get(resourceKey) ?? 0;
    if (!plan?.enabled || !plan.valid || outputRate <= EPSILON) {
      return;
    }

    const demandKey = makeDemandKey(nodeId, resourceKey);
    const nextDemand = (this.outputDemand.get(demandKey) ?? 0) + amountPerSecond;
    this.outputDemand.set(demandKey, nextDemand);

    this.ensureNodeOperations(nodeId, nextDemand / outputRate, new Set());
  }

  private ensureNodeOperations(
    nodeId: string,
    exactMachineDemand: number,
    suppliedInputKeys: Set<ResourceKey>,
  ): number {
    if (!Number.isFinite(exactMachineDemand) || exactMachineDemand <= EPSILON) {
      return 0;
    }

    const previous = this.operationDemand.get(nodeId) ?? 0;
    if (exactMachineDemand <= previous + EPSILON) {
      return 0;
    }

    const delta = exactMachineDemand - previous;
    this.operationDemand.set(nodeId, exactMachineDemand);
    this.machineCounts.set(
      nodeId,
      Math.max(this.machineCounts.get(nodeId) ?? 1, roundMachineCount(exactMachineDemand)),
    );
    this.creditDirectStorageOutputs(nodeId, delta);
    this.propagateNodeInputs(nodeId, delta, suppliedInputKeys);
    return delta;
  }

  private propagateNodeInputs(
    nodeId: string,
    exactMachineDelta: number,
    suppliedInputKeys: Set<ResourceKey>,
  ) {
    const plan = this.context.ratePlans.get(nodeId);
    if (!plan || exactMachineDelta <= EPSILON) {
      return;
    }

    for (const [inputKey, inputRate] of plan.inputs) {
      if (suppliedInputKeys.has(inputKey) || inputRate <= EPSILON) {
        continue;
      }

      this.satisfyNodeInput(nodeId, inputKey, inputRate * exactMachineDelta);
    }
  }

  private satisfyNodeInput(nodeId: string, inputKey: ResourceKey, amountPerSecond: number) {
    if (amountPerSecond <= EPSILON) {
      return;
    }

    const supplier = this.selectNodeInputSupplier(nodeId, inputKey, amountPerSecond);
    if (!supplier) {
      return;
    }

    if (supplier.sourceNodeId) {
      this.requireNodeOutput(supplier.sourceNodeId, supplier.resourceKey, amountPerSecond, nodeId);
      return;
    }

    this.satisfyStorageDemand(inputKey, amountPerSecond, nodeId);
  }

  private selectNodeInputSupplier(
    nodeId: string,
    inputKey: ResourceKey,
    amountPerSecond: number,
  ): Supplier | undefined {
    const suppliers = (
      this.context.incomingSuppliersByNodeResource.get(makeDemandKey(nodeId, inputKey)) ?? []
    ).filter((supplier) => !this.isInternalCyclicDemand(supplier.source, nodeId));

    return suppliers
      .map((supplier) => ({
        supplier,
        cost: supplier.sourceNodeId
          ? this.estimateNodeOutputCost(
              supplier.sourceNodeId,
              supplier.resourceKey,
              amountPerSecond,
              new Set(),
            )
          : this.estimateStorageCost(inputKey, amountPerSecond, new Set()),
        outputRate: supplier.sourceNodeId
          ? (this.context.ratePlans.get(supplier.sourceNodeId)?.outputs.get(supplier.resourceKey) ??
            0)
          : this.getBestStorageContributionRate(inputKey),
        nodeId: supplier.sourceNodeId ?? supplier.sourceStorageBusId ?? supplier.source,
      }))
      .sort(compareCandidateScores)[0]?.supplier;
  }

  private satisfyStorageDemand(
    resourceKey: ResourceKey,
    amountPerSecond: number,
    consumerEndpoint: EndpointId | undefined,
  ) {
    const remainingAfterCredit = this.consumeStorageCredit(resourceKey, amountPerSecond);
    if (remainingAfterCredit <= EPSILON) {
      return;
    }

    const candidate = this.selectStorageProducer(
      resourceKey,
      remainingAfterCredit,
      consumerEndpoint,
    );
    if (!candidate) {
      return;
    }

    this.applyStorageProducer(candidate.nodeId, resourceKey, remainingAfterCredit);
    this.consumeStorageCredit(resourceKey, remainingAfterCredit);
  }

  private selectStorageProducer(
    resourceKey: ResourceKey,
    amountPerSecond: number,
    consumerEndpoint: EndpointId | undefined,
  ): { nodeId: string; contribution: StorageContribution } | undefined {
    return this.getStorageProducerCandidates(resourceKey, consumerEndpoint)
      .map((candidate) => ({
        ...candidate,
        cost: this.estimateStorageCandidateCost(
          candidate.nodeId,
          resourceKey,
          amountPerSecond,
          new Set(),
        ),
        outputRate: candidate.contribution.amountPerMachine,
      }))
      .sort(compareCandidateScores)[0];
  }

  private getStorageProducerCandidates(
    resourceKey: ResourceKey,
    consumerEndpoint: EndpointId | undefined,
  ): Array<{ nodeId: string; contribution: StorageContribution }> {
    const nodeIds = new Set<string>();
    for (const producer of this.context.storageProducersByResource.get(resourceKey) ?? []) {
      nodeIds.add(producer.nodeId);
    }
    for (const plan of this.context.ratePlans.values()) {
      if (plan.enabled && plan.valid) {
        const contribution = this.getStorageContribution(plan.node.id, resourceKey, new Set());
        if (contribution.amountPerMachine > EPSILON) {
          nodeIds.add(plan.node.id);
        }
      }
    }

    return [...nodeIds]
      .filter((nodeId) => !this.isInternalCyclicDemand(nodeId, consumerEndpoint))
      .map((nodeId) => ({
        nodeId,
        contribution: this.getStorageContribution(nodeId, resourceKey, new Set()),
      }))
      .filter((candidate) => candidate.contribution.amountPerMachine > EPSILON);
  }

  private applyStorageProducer(nodeId: string, resourceKey: ResourceKey, amountPerSecond: number) {
    const contribution = this.getStorageContribution(nodeId, resourceKey, new Set());
    if (contribution.amountPerMachine <= EPSILON) {
      return;
    }

    const exactMachineDemand = amountPerSecond / contribution.amountPerMachine;
    const appliedDelta = this.ensureNodeOperations(nodeId, exactMachineDemand, new Set());
    if (appliedDelta <= EPSILON) {
      return;
    }

    this.applyContributionLinks(contribution, appliedDelta, resourceKey, nodeId);
  }

  private applyContributionLinks(
    contribution: StorageContribution,
    exactParentMachineDelta: number,
    storageResourceKey: ResourceKey,
    parentEndpoint: EndpointId,
  ) {
    for (const link of contribution.links) {
      if (this.isInternalCyclicDemand(link.childNodeId, parentEndpoint)) {
        continue;
      }

      this.applyNodeInputDrivenContribution(
        link.childNodeId,
        link.childInputKey,
        link.inputPerParentMachine * exactParentMachineDelta,
        storageResourceKey,
        parentEndpoint,
      );
    }
  }

  private applyNodeInputDrivenContribution(
    nodeId: string,
    inputKey: ResourceKey,
    amountPerSecond: number,
    storageResourceKey: ResourceKey,
    parentEndpoint: EndpointId,
  ) {
    const plan = this.context.ratePlans.get(nodeId);
    const inputRate = plan?.inputs.get(inputKey) ?? 0;
    if (
      !plan?.enabled ||
      !plan.valid ||
      inputRate <= EPSILON ||
      this.isInternalCyclicDemand(nodeId, parentEndpoint)
    ) {
      return;
    }

    const exactMachineDemand = amountPerSecond / inputRate;
    const appliedDelta = this.ensureNodeOperations(nodeId, exactMachineDemand, new Set([inputKey]));
    if (appliedDelta <= EPSILON) {
      return;
    }

    const contribution = this.getStorageContribution(nodeId, storageResourceKey, new Set());
    this.applyContributionLinks(contribution, appliedDelta, storageResourceKey, nodeId);
  }

  private creditDirectStorageOutputs(nodeId: string, exactMachineDelta: number) {
    const plan = this.context.ratePlans.get(nodeId);
    if (!plan || exactMachineDelta <= EPSILON) {
      return;
    }

    for (const edge of this.context.nodeToStorageEdges.get(nodeId) ?? []) {
      const storageKey = this.context.storageResourceById.get(edge.target);
      if (!storageKey) {
        continue;
      }

      const outputKey = makeResourceKey(edge.resourceKind, edge.resourceId);
      const outputRate = plan.outputs.get(outputKey) ?? 0;
      if (outputRate <= EPSILON) {
        continue;
      }

      this.storageCredits.set(
        storageKey,
        (this.storageCredits.get(storageKey) ?? 0) + outputRate * exactMachineDelta,
      );
    }
  }

  private consumeStorageCredit(resourceKey: ResourceKey, amountPerSecond: number): number {
    if (amountPerSecond <= EPSILON) {
      return 0;
    }

    const available = this.storageCredits.get(resourceKey) ?? 0;
    const consumed = Math.min(available, amountPerSecond);
    this.storageCredits.set(resourceKey, available - consumed);
    return amountPerSecond - consumed;
  }

  private getStorageContribution(
    nodeId: string,
    storageResourceKey: ResourceKey,
    stack: Set<string>,
  ): StorageContribution {
    const cacheKey = makeDemandKey(nodeId, storageResourceKey);
    const cached = this.contributionCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    if (stack.has(cacheKey)) {
      return { amountPerMachine: 0, links: [] };
    }

    const plan = this.context.ratePlans.get(nodeId);
    if (!plan?.enabled || !plan.valid) {
      return { amountPerMachine: 0, links: [] };
    }

    stack.add(cacheKey);
    let amountPerMachine = 0;
    const links: ContributionLink[] = [];

    for (const edge of this.context.nodeToStorageEdges.get(nodeId) ?? []) {
      const storageKey = this.context.storageResourceById.get(edge.target);
      if (storageKey !== storageResourceKey) {
        continue;
      }

      amountPerMachine +=
        plan.outputs.get(makeResourceKey(edge.resourceKind, edge.resourceId)) ?? 0;
    }

    for (const edge of this.context.nodeToNodeEdges.get(nodeId) ?? []) {
      const childNodeId = edge.target;
      if (this.isInternalCyclicDemand(childNodeId, nodeId)) {
        continue;
      }

      const outputKey = makeResourceKey(edge.resourceKind, edge.resourceId);
      const outputRate = plan.outputs.get(outputKey) ?? 0;
      const childPlan = this.context.ratePlans.get(childNodeId);
      const childInputKey = getEdgeTargetDemandKey(this.context, edge);
      const childInputRate = childInputKey ? (childPlan?.inputs.get(childInputKey) ?? 0) : 0;
      if (!childInputKey || outputRate <= EPSILON || childInputRate <= EPSILON) {
        continue;
      }

      const childContribution = this.getStorageContribution(childNodeId, storageResourceKey, stack);
      if (childContribution.amountPerMachine <= EPSILON) {
        continue;
      }

      amountPerMachine += outputRate * (childContribution.amountPerMachine / childInputRate);
      links.push({
        childNodeId,
        childInputKey,
        inputPerParentMachine: outputRate,
      });
    }

    stack.delete(cacheKey);
    const contribution = { amountPerMachine, links };
    this.contributionCache.set(cacheKey, contribution);
    return contribution;
  }

  private estimateStorageCost(
    resourceKey: ResourceKey,
    amountPerSecond: number,
    stack: Set<string>,
  ): number {
    const candidates = this.getStorageProducerCandidates(resourceKey, undefined);
    if (candidates.length === 0) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.min(
      ...candidates.map((candidate) =>
        this.estimateStorageCandidateCost(candidate.nodeId, resourceKey, amountPerSecond, stack),
      ),
    );
  }

  private estimateStorageCandidateCost(
    nodeId: string,
    resourceKey: ResourceKey,
    amountPerSecond: number,
    stack: Set<string>,
  ): number {
    const stackKey = `storage:${nodeId}:${resourceKey}`;
    if (stack.has(stackKey)) {
      return Number.POSITIVE_INFINITY;
    }

    const contribution = this.getStorageContribution(nodeId, resourceKey, new Set());
    if (contribution.amountPerMachine <= EPSILON) {
      return Number.POSITIVE_INFINITY;
    }

    stack.add(stackKey);
    const exactMachineDemand = amountPerSecond / contribution.amountPerMachine;
    let cost = this.estimateNodeOperationCost(nodeId, exactMachineDemand, new Set(), stack);
    for (const link of contribution.links) {
      cost += this.estimateNodeInputDrivenCost(
        link.childNodeId,
        link.childInputKey,
        link.inputPerParentMachine * exactMachineDemand,
        resourceKey,
        stack,
      );
    }
    stack.delete(stackKey);
    return cost;
  }

  private estimateNodeOutputCost(
    nodeId: string,
    resourceKey: ResourceKey,
    amountPerSecond: number,
    stack: Set<string>,
  ): number {
    const plan = this.context.ratePlans.get(nodeId);
    const outputRate = plan?.outputs.get(resourceKey) ?? 0;
    if (!plan?.enabled || !plan.valid || outputRate <= EPSILON) {
      return Number.POSITIVE_INFINITY;
    }

    return this.estimateNodeOperationCost(nodeId, amountPerSecond / outputRate, new Set(), stack);
  }

  private estimateNodeInputDrivenCost(
    nodeId: string,
    inputKey: ResourceKey,
    amountPerSecond: number,
    storageResourceKey: ResourceKey,
    stack: Set<string>,
  ): number {
    const plan = this.context.ratePlans.get(nodeId);
    const inputRate = plan?.inputs.get(inputKey) ?? 0;
    if (!plan?.enabled || !plan.valid || inputRate <= EPSILON) {
      return Number.POSITIVE_INFINITY;
    }

    const exactMachineDemand = amountPerSecond / inputRate;
    let cost = this.estimateNodeOperationCost(
      nodeId,
      exactMachineDemand,
      new Set([inputKey]),
      stack,
    );
    const contribution = this.getStorageContribution(nodeId, storageResourceKey, new Set());
    for (const link of contribution.links) {
      cost += this.estimateNodeInputDrivenCost(
        link.childNodeId,
        link.childInputKey,
        link.inputPerParentMachine * exactMachineDemand,
        storageResourceKey,
        stack,
      );
    }
    return cost;
  }

  private estimateNodeOperationCost(
    nodeId: string,
    exactMachineDemand: number,
    suppliedInputKeys: Set<ResourceKey>,
    stack: Set<string>,
  ): number {
    if (!Number.isFinite(exactMachineDemand) || exactMachineDemand <= EPSILON) {
      return 0;
    }

    const stackKey = `node:${nodeId}`;
    if (stack.has(stackKey)) {
      return Number.POSITIVE_INFINITY;
    }

    const plan = this.context.ratePlans.get(nodeId);
    if (!plan?.enabled || !plan.valid) {
      return Number.POSITIVE_INFINITY;
    }

    stack.add(stackKey);
    let cost = roundMachineCount(exactMachineDemand);
    for (const [inputKey, inputRate] of plan.inputs) {
      if (suppliedInputKeys.has(inputKey) || inputRate <= EPSILON) {
        continue;
      }

      const supplierCost = this.estimateBestNodeInputSupplierCost(
        nodeId,
        inputKey,
        inputRate * exactMachineDemand,
        stack,
      );
      if (Number.isFinite(supplierCost)) {
        cost += supplierCost;
      }
    }
    stack.delete(stackKey);
    return cost;
  }

  private estimateBestNodeInputSupplierCost(
    nodeId: string,
    inputKey: ResourceKey,
    amountPerSecond: number,
    stack: Set<string>,
  ): number {
    const suppliers = (
      this.context.incomingSuppliersByNodeResource.get(makeDemandKey(nodeId, inputKey)) ?? []
    ).filter((supplier) => !this.isInternalCyclicDemand(supplier.source, nodeId));
    if (suppliers.length === 0) {
      return 0;
    }

    return Math.min(
      ...suppliers.map((supplier) =>
        supplier.sourceNodeId
          ? this.estimateNodeOutputCost(
              supplier.sourceNodeId,
              supplier.resourceKey,
              amountPerSecond,
              stack,
            )
          : this.estimateStorageCost(inputKey, amountPerSecond, stack),
      ),
    );
  }

  private getBestStorageContributionRate(resourceKey: ResourceKey): number {
    return Math.max(
      0,
      ...this.getStorageProducerCandidates(resourceKey, undefined).map(
        (candidate) => candidate.contribution.amountPerMachine,
      ),
    );
  }

  private isInternalCyclicDemand(
    sourceEndpoint: EndpointId,
    targetEndpoint: EndpointId | undefined,
  ) {
    if (!targetEndpoint) {
      return false;
    }

    const sourceComponent = this.context.componentByEndpoint.get(sourceEndpoint);
    const targetComponent = this.context.componentByEndpoint.get(targetEndpoint);
    return (
      sourceComponent !== undefined &&
      sourceComponent === targetComponent &&
      this.context.cyclicComponents.has(sourceComponent)
    );
  }
}

export function optimizeMachineCountsForProject(
  project: FactoryProject,
): MachineCountOptimizationResult {
  const context = buildGraphContext(project);
  return new MachineCountOptimizer(context).optimize();
}

function buildGraphContext(project: FactoryProject): GraphContext {
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  const storagesById = new Map((project.storages ?? []).map((storage) => [storage.id, storage]));
  const storageResourceById = new Map(
    [...storagesById.values()].map((storage) => [
      storage.id,
      makeResourceKey(storage.kind, storage.resourceId),
    ]),
  );
  const diagnostics: string[] = [];
  const ratePlans = new Map<string, RatePlan>();
  const adjacency = new Map<EndpointId, EndpointId[]>();
  const incomingSuppliersByNodeResource = new Map<string, Supplier[]>();
  const storageProducersByResource = new Map<ResourceKey, StorageProducer[]>();
  const nodeToStorageEdges = new Map<string, FactoryEdge[]>();
  const nodeToNodeEdges = new Map<string, FactoryEdge[]>();

  for (const node of project.nodes) {
    adjacency.set(node.id, []);
    ratePlans.set(node.id, buildRatePlan(node, recipesById.get(node.recipeId)));
  }
  for (const storageKey of new Set(storageResourceById.values())) {
    adjacency.set(storageBusId(storageKey), []);
  }

  for (const edge of project.edges) {
    const sourceStorageKey = storageResourceById.get(edge.source);
    const targetStorageKey = storageResourceById.get(edge.target);
    const sourceEndpoint = sourceStorageKey ? storageBusId(sourceStorageKey) : edge.source;
    const targetEndpoint = targetStorageKey ? storageBusId(targetStorageKey) : edge.target;
    if (!adjacency.has(sourceEndpoint) || !adjacency.has(targetEndpoint)) {
      continue;
    }

    if (sourceEndpoint !== targetEndpoint) {
      adjacency.get(sourceEndpoint)?.push(targetEndpoint);
    }

    if (!sourceStorageKey && targetStorageKey) {
      const resourceKey = makeResourceKey(edge.resourceKind, edge.resourceId);
      addToMapList(nodeToStorageEdges, edge.source, edge);
      addToMapList(storageProducersByResource, targetStorageKey, {
        nodeId: edge.source,
        resourceKey,
      });
      continue;
    }

    if (!sourceStorageKey && !targetStorageKey) {
      addToMapList(nodeToNodeEdges, edge.source, edge);
    }

    if (!targetStorageKey) {
      const targetInputKey = getEdgeTargetDemandKeyFromPlans(ratePlans, edge);
      if (!targetInputKey) {
        continue;
      }

      addToMapList(incomingSuppliersByNodeResource, makeDemandKey(edge.target, targetInputKey), {
        source: sourceEndpoint,
        sourceNodeId: sourceStorageKey ? undefined : edge.source,
        sourceStorageBusId: sourceStorageKey ? sourceEndpoint : undefined,
        resourceKey: sourceStorageKey
          ? sourceStorageKey
          : makeResourceKey(edge.resourceKind, edge.resourceId),
      });
    }
  }

  const { componentByEndpoint, cyclicComponents } = findStronglyConnectedComponents(adjacency);
  const sccCount = new Set(componentByEndpoint.values()).size;
  const maxPropagationPasses = Math.max(1, project.nodes.length + sccCount + 1);
  diagnostics.push(`optimizer:bounded:${maxPropagationPasses}`);

  return {
    project,
    nodesById,
    recipesById,
    storagesById,
    storageResourceById,
    ratePlans,
    adjacency,
    componentByEndpoint,
    cyclicComponents,
    incomingSuppliersByNodeResource,
    storageProducersByResource,
    nodeToStorageEdges,
    nodeToNodeEdges,
    diagnostics,
  };
}

function buildRatePlan(node: FactoryNode, recipe: Recipe | undefined): RatePlan {
  if (!recipe) {
    return {
      node,
      inputs: new Map(),
      outputs: new Map(),
      inputDefinitions: [],
      enabled: node.enabled,
      valid: false,
    };
  }

  if (!node.enabled) {
    return {
      node,
      recipe,
      inputs: new Map(),
      outputs: new Map(),
      inputDefinitions: [],
      enabled: false,
      valid: true,
    };
  }

  const nodeRecipe = applyRecipeInputOverrides(recipe, node);
  const effectiveRecipe = applyMachineHandlerToRecipe(nodeRecipe, node);
  const overclockedRecipe = getOverclockedRecipeStats(nodeRecipe, node);
  const machineParallelMultiplier = getMachineParallelMultiplier(effectiveRecipe, node);
  const operationRatePerMachine =
    (node.parallel * machineParallelMultiplier * TICKS_PER_SECOND) /
    overclockedRecipe.durationTicks;
  const inputs = new Map<ResourceKey, number>();
  const outputs = new Map<ResourceKey, number>();

  for (const input of nodeRecipe.inputs) {
    if (!isRecipeInputConsumed(input)) {
      continue;
    }

    addRate(inputs, makeResourceKey(input.kind, input.id), input.amount * operationRatePerMachine);
  }

  for (const output of effectiveRecipe.outputs) {
    const outputRate =
      output.amount *
      getChanceMultiplier(output) *
      getMachineOutputMultiplier(effectiveRecipe, node, output, overclockedRecipe.tier) *
      operationRatePerMachine;
    addRate(outputs, makeResourceKey(output.kind, output.id), outputRate);
  }

  return {
    node,
    recipe: nodeRecipe,
    effectiveRecipe,
    inputs,
    outputs,
    inputDefinitions: nodeRecipe.inputs.filter(isRecipeInputConsumed),
    enabled: true,
    valid: true,
  };
}

function getEdgeTargetDemandKey(context: GraphContext, edge: FactoryEdge): ResourceKey | undefined {
  return getEdgeTargetDemandKeyFromPlans(context.ratePlans, edge);
}

function getEdgeTargetDemandKeyFromPlans(
  ratePlans: Map<string, RatePlan>,
  edge: FactoryEdge,
): ResourceKey | undefined {
  const plan = ratePlans.get(edge.target);
  const edgeResource = { kind: edge.resourceKind, id: edge.resourceId };
  const input = plan?.inputDefinitions.find((entry) => resourceMatchesInput(edgeResource, entry));
  return input ? makeResourceKey(input.kind, input.id) : undefined;
}

function findStronglyConnectedComponents(adjacency: Map<EndpointId, EndpointId[]>): {
  componentByEndpoint: Map<EndpointId, number>;
  cyclicComponents: Set<number>;
} {
  let nextIndex = 0;
  let nextComponent = 0;
  const indexes = new Map<EndpointId, number>();
  const lowLinks = new Map<EndpointId, number>();
  const stack: EndpointId[] = [];
  const onStack = new Set<EndpointId>();
  const componentByEndpoint = new Map<EndpointId, number>();
  const cyclicComponents = new Set<number>();

  const visit = (endpoint: EndpointId) => {
    indexes.set(endpoint, nextIndex);
    lowLinks.set(endpoint, nextIndex);
    nextIndex += 1;
    stack.push(endpoint);
    onStack.add(endpoint);

    for (const target of adjacency.get(endpoint) ?? []) {
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(endpoint, Math.min(lowLinks.get(endpoint) ?? 0, lowLinks.get(target) ?? 0));
      } else if (onStack.has(target)) {
        lowLinks.set(endpoint, Math.min(lowLinks.get(endpoint) ?? 0, indexes.get(target) ?? 0));
      }
    }

    if (lowLinks.get(endpoint) !== indexes.get(endpoint)) {
      return;
    }

    const component: EndpointId[] = [];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        break;
      }

      onStack.delete(current);
      componentByEndpoint.set(current, nextComponent);
      component.push(current);
      if (current === endpoint) {
        break;
      }
    }

    if (
      component.length > 1 ||
      component.some((entry) => (adjacency.get(entry) ?? []).includes(entry))
    ) {
      cyclicComponents.add(nextComponent);
    }
    nextComponent += 1;
  };

  for (const endpoint of adjacency.keys()) {
    if (!indexes.has(endpoint)) {
      visit(endpoint);
    }
  }

  return { componentByEndpoint, cyclicComponents };
}

function compareCandidateScores(
  left: { cost: number; outputRate: number; nodeId?: string },
  right: { cost: number; outputRate: number; nodeId?: string },
) {
  if (left.cost !== right.cost) {
    return left.cost - right.cost;
  }

  if (right.outputRate !== left.outputRate) {
    return right.outputRate - left.outputRate;
  }

  return (left.nodeId ?? "").localeCompare(right.nodeId ?? "");
}

function storageBusId(resourceKey: ResourceKey): EndpointId {
  return `${STORAGE_BUS_PREFIX}${resourceKey}`;
}

function makeDemandKey(nodeId: string, resourceKey: ResourceKey): string {
  return `${nodeId}|${resourceKey}`;
}

function addRate(rates: Map<ResourceKey, number>, key: ResourceKey, amount: number) {
  rates.set(key, (rates.get(key) ?? 0) + amount);
}

function addToMapList<K, V>(map: Map<K, V[]>, key: K, value: V) {
  map.set(key, [...(map.get(key) ?? []), value]);
}

function roundMachineCount(exactMachineDemand: number): number {
  if (!Number.isFinite(exactMachineDemand) || exactMachineDemand <= EPSILON) {
    return 1;
  }

  return Math.max(1, Math.ceil(exactMachineDemand - EPSILON));
}

function normalizeMachineCount(machineCount: number): number {
  if (!Number.isFinite(machineCount) || machineCount <= 0) {
    return 1;
  }

  return Math.max(1, Math.round(machineCount));
}
