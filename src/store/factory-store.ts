"use client";

import { create } from "zustand";
import { createEmptyProject } from "@/examples";
import type { DatasetManifest, RecipeDataset } from "@/lib/datasets";
import { calculateThroughput } from "@/lib/solver";
import { getResourceKey, primaryOutput, resourceLabel } from "@/lib/model/resources";
import type {
  FactoryEdge,
  FactoryNode,
  FactoryProject,
  Recipe,
  ResourceAmount,
  ResourceKind,
  TargetRate,
  ThroughputResult,
} from "@/lib/model/types";

export const LOCAL_STORAGE_KEY = "gtnh-factory-flow.project.v2";
export const RESOURCE_HISTORY_STORAGE_KEY = "gtnh-factory-flow.resource-history.v1";

interface FactoryStore {
  project: FactoryProject;
  datasetManifest?: DatasetManifest;
  dataset?: RecipeDataset;
  datasetManifestUrl?: string;
  selectedDatasetVersionId?: string;
  isDatasetLoading: boolean;
  datasetError?: string;
  recipeSearch: string;
  recipeBrowserResource?: RecipeBrowserResource;
  recipeBrowserMode: RecipeBrowserMode;
  recipeResourceHistory: RecipeBrowserResource[];
  pendingResourceConnection?: PendingResourceConnection;
  selectedNodeId?: string;
  selectedRecipeId?: string;
  lastResult: ThroughputResult;
  setProject: (project: FactoryProject) => void;
  markHydratedProject: (project: FactoryProject) => void;
  setDatasetManifest: (manifest: DatasetManifest, manifestUrl: string) => void;
  setDataset: (dataset: RecipeDataset) => void;
  clearDataset: () => void;
  setDatasetLoading: (isLoading: boolean) => void;
  setDatasetError: (error?: string) => void;
  setRecipeSearch: (query: string) => void;
  hydrateResourceHistory: (history: RecipeBrowserResource[]) => void;
  browseResource: (resource: RecipeBrowserResource, mode?: RecipeBrowserMode) => void;
  clearResourceBrowser: () => void;
  cleanBoard: () => void;
  selectResourceConnectionSlot: (slot: PendingResourceConnection) => void;
  cancelResourceConnection: () => void;
  recalculate: () => void;
  selectNode: (nodeId?: string) => void;
  selectRecipe: (recipeId?: string) => void;
  addNodeForRecipe: (recipeId: string) => void;
  addConnectedNodeForRecipe: (
    recipeId: string,
    anchorNodeId: string,
    resource: Pick<ResourceAmount, "kind" | "id" | "displayName"> & {
      mode: RecipeBrowserMode;
    },
  ) => void;
  updateNode: (nodeId: string, patch: Partial<FactoryNode>) => void;
  deleteNode: (nodeId: string) => void;
  setNodePosition: (nodeId: string, position: FactoryNode["position"]) => void;
  connectNodes: (
    sourceNodeId: string,
    targetNodeId: string,
    resource?: Pick<ResourceAmount, "kind" | "id" | "displayName"> & {
      sourceHandle?: string;
      targetHandle?: string;
    },
  ) => void;
  autoConnectNode: (nodeId: string) => void;
  deleteEdge: (edgeId: string) => void;
  setTargetRate: (targetRate?: TargetRate) => void;
  selectFuelProfile: (fuelProfileId: string) => void;
}

const initialProject = createEmptyProject();

export type RecipeBrowserMode = "recipes" | "uses";

export interface RecipeBrowserResource {
  kind: ResourceKind;
  id: string;
  displayName?: string;
  iconPath?: string;
  anchorNodeId?: string;
}

export interface PendingResourceConnection {
  nodeId: string;
  side: "input" | "output";
  kind: ResourceKind;
  resourceId: string;
  displayName?: string;
  iconPath?: string;
  handleId: string;
}

export const useFactoryStore = create<FactoryStore>((set, get) => ({
  project: initialProject,
  datasetManifest: undefined,
  dataset: undefined,
  datasetManifestUrl: undefined,
  selectedDatasetVersionId: undefined,
  isDatasetLoading: false,
  datasetError: undefined,
  recipeSearch: "",
  recipeBrowserResource: undefined,
  recipeBrowserMode: "recipes",
  recipeResourceHistory: [],
  pendingResourceConnection: undefined,
  selectedNodeId: undefined,
  selectedRecipeId: undefined,
  lastResult: calculateThroughput(initialProject),
  setProject: (project) => {
    const nextProject = touchProject(project);
    set({
      project: nextProject,
      selectedNodeId: nextProject.nodes[0]?.id,
      selectedRecipeId: nextProject.nodes[0]?.recipeId ?? nextProject.recipes[0]?.id,
      lastResult: calculateThroughput(nextProject),
    });
  },
  markHydratedProject: (project) => {
    set({
      project,
      selectedNodeId: project.nodes[0]?.id,
      selectedRecipeId: project.nodes[0]?.recipeId ?? project.recipes[0]?.id,
      lastResult: calculateThroughput(project),
    });
  },
  setDatasetManifest: (manifest, manifestUrl) => {
    set((state) => ({
      datasetManifest: manifest,
      datasetManifestUrl: manifestUrl,
      selectedDatasetVersionId:
        state.selectedDatasetVersionId ??
        manifest.latestStableVersion ??
        manifest.latestDailyVersion ??
        manifest.versions[0]?.id,
      datasetError: undefined,
    }));
  },
  setDataset: (dataset) => {
    set((state) => ({
      dataset,
      selectedDatasetVersionId: dataset.datasetVersionId,
      selectedRecipeId:
        state.selectedRecipeId &&
        dataset.recipes.some((recipe) => recipe.id === state.selectedRecipeId)
          ? state.selectedRecipeId
          : dataset.recipes[0]?.id,
      datasetError: undefined,
      isDatasetLoading: false,
    }));
  },
  clearDataset: () => {
    set({
      dataset: undefined,
      recipeSearch: "",
      selectedRecipeId: undefined,
      selectedDatasetVersionId: undefined,
    });
  },
  setDatasetLoading: (isLoading) => {
    set({ isDatasetLoading: isLoading });
  },
  setDatasetError: (error) => {
    set({ datasetError: error, isDatasetLoading: false });
  },
  setRecipeSearch: (query) => {
    set({ recipeSearch: query });
  },
  hydrateResourceHistory: (history) => {
    set({ recipeResourceHistory: normalizeResourceHistory(history) });
  },
  browseResource: (resource, mode = "recipes") => {
    set((state) => {
      const recipeResourceHistory = updateResourceHistory(state.recipeResourceHistory, resource);
      saveResourceHistory(recipeResourceHistory);

      return {
        recipeBrowserResource: resource,
        recipeBrowserMode: mode,
        recipeResourceHistory,
        selectedNodeId: resource.anchorNodeId,
      };
    });
  },
  clearResourceBrowser: () => {
    set({
      recipeBrowserResource: undefined,
      recipeSearch: "",
    });
  },
  cleanBoard: () => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        recipes: [],
        nodes: [],
        edges: [],
        targetRate: undefined,
      });

      return {
        project,
        recipeBrowserResource: undefined,
        pendingResourceConnection: undefined,
        selectedNodeId: undefined,
        selectedRecipeId: state.dataset?.recipes[0]?.id,
        lastResult: calculateThroughput(project),
      };
    });
  },
  selectResourceConnectionSlot: (slot) => {
    set((state) => {
      const pending = state.pendingResourceConnection;

      if (!pending) {
        return {
          pendingResourceConnection: slot,
          selectedNodeId: slot.nodeId,
        };
      }

      if (pending.nodeId === slot.nodeId && pending.handleId === slot.handleId) {
        return {
          pendingResourceConnection: undefined,
          selectedNodeId: slot.nodeId,
        };
      }

      if (!canConnectPendingSlots(pending, slot)) {
        return {
          pendingResourceConnection: slot,
          selectedNodeId: slot.nodeId,
        };
      }

      const source = pending.side === "output" ? pending : slot;
      const target = pending.side === "input" ? pending : slot;
      const edge = buildEdgeBetweenNodes(state.project, source.nodeId, target.nodeId, {
        kind: source.kind,
        id: source.resourceId,
        displayName: source.displayName ?? target.displayName,
        sourceHandle: source.handleId,
        targetHandle: target.handleId,
      });

      if (!edge || hasDuplicateEdge(state.project.edges, edge)) {
        return {
          pendingResourceConnection: undefined,
          selectedNodeId: slot.nodeId,
        };
      }

      const project = touchProject({
        ...state.project,
        edges: [...state.project.edges, edge],
      });

      return {
        project,
        pendingResourceConnection: undefined,
        selectedNodeId: slot.nodeId,
        lastResult: calculateThroughput(project),
      };
    });
  },
  cancelResourceConnection: () => {
    set({ pendingResourceConnection: undefined });
  },
  recalculate: () => {
    const { project } = get();
    set({ lastResult: calculateThroughput(project) });
  },
  selectNode: (nodeId) => {
    const node = get().project.nodes.find((entry) => entry.id === nodeId);
    set({
      selectedNodeId: nodeId,
      selectedRecipeId: node?.recipeId ?? get().selectedRecipeId,
    });
  },
  selectRecipe: (recipeId) => {
    set({ selectedRecipeId: recipeId, selectedNodeId: undefined });
  },
  addNodeForRecipe: (recipeId) => {
    set((state) => {
      const recipe = findRecipeForPlanning(state, recipeId);
      if (!recipe) {
        return state;
      }

      const index = state.project.nodes.length;
      const node: FactoryNode = {
        id: createId("node"),
        recipeId,
        machineCount: 1,
        parallel: 1,
        overclockTier: recipe.minimumTier,
        enabled: true,
        position: {
          x: 100 + index * 90,
          y: 120 + (index % 4) * 90,
        },
      };
      const recipeAlreadyInProject = state.project.recipes.some((entry) => entry.id === recipe.id);
      const project = touchProject({
        ...state.project,
        recipes: recipeAlreadyInProject
          ? state.project.recipes
          : [...state.project.recipes, recipe],
        nodes: [...state.project.nodes, node],
      });

      return {
        project,
        selectedNodeId: node.id,
        selectedRecipeId: recipeId,
        lastResult: calculateThroughput(project),
      };
    });
  },
  addConnectedNodeForRecipe: (recipeId, anchorNodeId, resource) => {
    set((state) => {
      const recipe = findRecipeForPlanning(state, recipeId);
      const anchorNode = state.project.nodes.find((node) => node.id === anchorNodeId);
      const anchorRecipe = state.project.recipes.find((entry) => entry.id === anchorNode?.recipeId);

      if (!recipe || !anchorNode || !anchorRecipe) {
        return state;
      }

      const recipeAlreadyInProject = state.project.recipes.some((entry) => entry.id === recipe.id);
      const nextNode: FactoryNode = {
        id: createId("node"),
        recipeId,
        machineCount: 1,
        parallel: 1,
        overclockTier: recipe.minimumTier,
        enabled: true,
        position:
          resource.mode === "recipes"
            ? { x: anchorNode.position.x - 440, y: anchorNode.position.y }
            : { x: anchorNode.position.x + 440, y: anchorNode.position.y },
      };

      const projectWithNode: FactoryProject = {
        ...state.project,
        recipes: recipeAlreadyInProject
          ? state.project.recipes
          : [...state.project.recipes, recipe],
        nodes: [...state.project.nodes, nextNode],
      };

      const edge =
        resource.mode === "recipes"
          ? buildEdgeBetweenNodes(projectWithNode, nextNode.id, anchorNode.id, resource)
          : buildEdgeBetweenNodes(projectWithNode, anchorNode.id, nextNode.id, resource);

      const project = touchProject({
        ...projectWithNode,
        edges: edge ? [...projectWithNode.edges, edge] : projectWithNode.edges,
      });

      return {
        project,
        selectedNodeId: nextNode.id,
        selectedRecipeId: recipeId,
        lastResult: calculateThroughput(project),
      };
    });
  },
  updateNode: (nodeId, patch) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        nodes: state.project.nodes.map((node) =>
          node.id === nodeId ? { ...node, ...patch } : node,
        ),
      });
      return {
        project,
        lastResult: calculateThroughput(project),
      };
    });
  },
  deleteNode: (nodeId) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        nodes: state.project.nodes.filter((node) => node.id !== nodeId),
        edges: state.project.edges.filter(
          (edge) => edge.source !== nodeId && edge.target !== nodeId,
        ),
      });
      return {
        project,
        pendingResourceConnection:
          state.pendingResourceConnection?.nodeId === nodeId
            ? undefined
            : state.pendingResourceConnection,
        selectedNodeId: project.nodes[0]?.id,
        selectedRecipeId: project.nodes[0]?.recipeId ?? state.selectedRecipeId,
        lastResult: calculateThroughput(project),
      };
    });
  },
  setNodePosition: (nodeId, position) => {
    get().updateNode(nodeId, { position });
  },
  connectNodes: (sourceNodeId, targetNodeId, resource) => {
    set((state) => {
      const edge = buildEdgeBetweenNodes(state.project, sourceNodeId, targetNodeId, resource);
      if (!edge) {
        return state;
      }

      if (hasDuplicateEdge(state.project.edges, edge)) {
        return state;
      }

      const project = touchProject({
        ...state.project,
        edges: [...state.project.edges, edge],
      });
      return {
        project,
        lastResult: calculateThroughput(project),
      };
    });
  },
  autoConnectNode: (nodeId) => {
    set((state) => {
      const node = state.project.nodes.find((entry) => entry.id === nodeId);
      if (!node) {
        return state;
      }

      const edges: FactoryEdge[] = [];
      const existingAndPending = [...state.project.edges];

      for (const otherNode of state.project.nodes) {
        if (otherNode.id === nodeId) {
          continue;
        }

        for (const edge of [
          ...buildCompatibleEdgesBetweenNodes(state.project, otherNode.id, nodeId),
          ...buildCompatibleEdgesBetweenNodes(state.project, nodeId, otherNode.id),
        ]) {
          if (!hasDuplicateEdge(existingAndPending, edge)) {
            edges.push(edge);
            existingAndPending.push(edge);
          }
        }
      }

      if (edges.length === 0) {
        return state;
      }

      const project = touchProject({
        ...state.project,
        edges: [...state.project.edges, ...edges],
      });

      return {
        project,
        lastResult: calculateThroughput(project),
      };
    });
  },
  deleteEdge: (edgeId) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        edges: state.project.edges.filter((edge) => edge.id !== edgeId),
      });
      return {
        project,
        lastResult: calculateThroughput(project),
      };
    });
  },
  setTargetRate: (targetRate) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        targetRate,
      });
      return {
        project,
        lastResult: calculateThroughput(project),
      };
    });
  },
  selectFuelProfile: (fuelProfileId) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        selectedFuelProfileId: fuelProfileId,
      });
      return {
        project,
        lastResult: calculateThroughput(project),
      };
    });
  },
}));

function canConnectPendingSlots(
  first: PendingResourceConnection,
  second: PendingResourceConnection,
): boolean {
  return (
    first.nodeId !== second.nodeId &&
    first.side !== second.side &&
    first.kind === second.kind &&
    first.resourceId === second.resourceId
  );
}

function findRecipeForPlanning(state: FactoryStore, recipeId: string): Recipe | undefined {
  return (
    state.dataset?.recipes.find((recipe) => recipe.id === recipeId) ??
    state.project.recipes.find((recipe) => recipe.id === recipeId)
  );
}

function buildEdgeBetweenNodes(
  project: FactoryProject,
  sourceNodeId: string,
  targetNodeId: string,
  selectedResource?: Pick<ResourceAmount, "kind" | "id" | "displayName"> & {
    sourceHandle?: string;
    targetHandle?: string;
  },
): FactoryEdge | undefined {
  const sourceNode = project.nodes.find((node) => node.id === sourceNodeId);
  const targetNode = project.nodes.find((node) => node.id === targetNodeId);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  const targetRecipe = project.recipes.find((recipe) => recipe.id === targetNode?.recipeId);

  if (!sourceNode || !targetNode || !sourceRecipe || !targetRecipe) {
    return undefined;
  }

  const matchedOutput = selectedResource
    ? sourceRecipe.outputs.find(
        (output) =>
          output.kind === selectedResource.kind &&
          output.id === selectedResource.id &&
          targetRecipe.inputs.some((input) => getResourceKey(input) === getResourceKey(output)),
      )
    : (sourceRecipe.outputs.find((output) =>
        targetRecipe.inputs.some((input) => getResourceKey(input) === getResourceKey(output)),
      ) ?? primaryOutput(sourceRecipe));

  if (!matchedOutput) {
    return undefined;
  }

  return {
    id: createId("edge"),
    source: sourceNode.id,
    target: targetNode.id,
    sourceHandle: selectedResource?.sourceHandle,
    targetHandle: selectedResource?.targetHandle,
    resourceKind: matchedOutput.kind,
    resourceId: matchedOutput.id,
    label: resourceLabel(matchedOutput),
  };
}

function buildCompatibleEdgesBetweenNodes(
  project: FactoryProject,
  sourceNodeId: string,
  targetNodeId: string,
): FactoryEdge[] {
  const sourceNode = project.nodes.find((node) => node.id === sourceNodeId);
  const targetNode = project.nodes.find((node) => node.id === targetNodeId);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  const targetRecipe = project.recipes.find((recipe) => recipe.id === targetNode?.recipeId);

  if (!sourceNode || !targetNode || !sourceRecipe || !targetRecipe) {
    return [];
  }

  const edges: FactoryEdge[] = [];

  sourceRecipe.outputs.forEach((output, outputIndex) => {
    targetRecipe.inputs.forEach((input, inputIndex) => {
      if (input.consumed === false || output.kind !== input.kind || output.id !== input.id) {
        return;
      }

      edges.push({
        id: createId("edge"),
        source: sourceNode.id,
        target: targetNode.id,
        sourceHandle: makeResourceHandleId("output", output, outputIndex),
        targetHandle: makeResourceHandleId("input", input, inputIndex),
        resourceKind: output.kind,
        resourceId: output.id,
        label: resourceLabel(output),
      });
    });
  });

  return edges;
}

function hasDuplicateEdge(edges: FactoryEdge[], edge: FactoryEdge): boolean {
  return edges.some(
    (existing) =>
      existing.source === edge.source &&
      existing.target === edge.target &&
      existing.resourceKind === edge.resourceKind &&
      existing.resourceId === edge.resourceId &&
      existing.sourceHandle === edge.sourceHandle &&
      existing.targetHandle === edge.targetHandle,
  );
}

function makeResourceHandleId(
  side: "input" | "output",
  resource: Pick<ResourceAmount, "kind" | "id">,
  slotIndex?: number,
): string {
  return `${side}:${resource.kind}:${encodeURIComponent(resource.id)}${slotIndex === undefined ? "" : `:${slotIndex}`}`;
}

function touchProject(project: FactoryProject): FactoryProject {
  return {
    ...project,
    metadata: {
      ...project.metadata,
      updatedAt: new Date().toISOString(),
    },
  };
}

function updateResourceHistory(
  history: RecipeBrowserResource[],
  resource: RecipeBrowserResource,
): RecipeBrowserResource[] {
  const entry: RecipeBrowserResource = {
    kind: resource.kind,
    id: resource.id,
    displayName: resource.displayName,
    iconPath: resource.iconPath,
  };
  const key = getResourceKey(entry);

  return [entry, ...history.filter((item) => getResourceKey(item) !== key)].slice(0, 80);
}

export function loadResourceHistory(): RecipeBrowserResource[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawHistory = window.localStorage.getItem(RESOURCE_HISTORY_STORAGE_KEY);
    if (!rawHistory) {
      return [];
    }

    return normalizeResourceHistory(JSON.parse(rawHistory));
  } catch {
    return [];
  }
}

function saveResourceHistory(history: RecipeBrowserResource[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      RESOURCE_HISTORY_STORAGE_KEY,
      JSON.stringify(normalizeResourceHistory(history)),
    );
  } catch {
    // Best effort cache: failing to persist quick access should not block browsing.
  }
}

function normalizeResourceHistory(value: unknown): RecipeBrowserResource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const history: RecipeBrowserResource[] = [];

  for (const item of value) {
    if (!isStoredRecipeBrowserResource(item)) {
      continue;
    }

    const entry: RecipeBrowserResource = {
      kind: item.kind,
      id: item.id,
      displayName: item.displayName,
      iconPath: item.iconPath,
    };
    const key = getResourceKey(entry);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    history.push(entry);
    if (history.length >= 80) {
      break;
    }
  }

  return history;
}

function isStoredRecipeBrowserResource(value: unknown): value is RecipeBrowserResource {
  if (!value || typeof value !== "object") {
    return false;
  }

  const resource = value as Partial<RecipeBrowserResource>;
  return (
    (resource.kind === "item" || resource.kind === "fluid") &&
    typeof resource.id === "string" &&
    resource.id.length > 0 &&
    (resource.displayName === undefined || typeof resource.displayName === "string") &&
    (resource.iconPath === undefined || typeof resource.iconPath === "string")
  );
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
