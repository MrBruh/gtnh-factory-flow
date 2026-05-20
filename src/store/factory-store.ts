"use client";

import { create } from "zustand";
import { createEmptyProject } from "@/examples";
import { enrichDatasetRecipes, type DatasetManifest, type RecipeDataset } from "@/lib/datasets";
import { calculateThroughput } from "@/lib/solver";
import { getResourceKey, primaryOutput, resourceLabel } from "@/lib/model/resources";
import type {
  FactoryEdge,
  FactoryNode,
  FactoryProject,
  Recipe,
  ResourceAmount,
  TargetRate,
  ThroughputResult,
} from "@/lib/model/types";

export const LOCAL_STORAGE_KEY = "gtnh-factory-flow.project.v2";

interface FactoryStore {
  project: FactoryProject;
  datasetManifest?: DatasetManifest;
  dataset?: RecipeDataset;
  datasetManifestUrl?: string;
  selectedDatasetVersionId?: string;
  isDatasetLoading: boolean;
  datasetError?: string;
  recipeSearch: string;
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
  recalculate: () => void;
  selectNode: (nodeId?: string) => void;
  selectRecipe: (recipeId?: string) => void;
  addNodeForRecipe: (recipeId: string) => void;
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
  deleteEdge: (edgeId: string) => void;
  setTargetRate: (targetRate?: TargetRate) => void;
  selectFuelProfile: (fuelProfileId: string) => void;
}

const initialProject = createEmptyProject();

export const useFactoryStore = create<FactoryStore>((set, get) => ({
  project: initialProject,
  datasetManifest: undefined,
  dataset: undefined,
  datasetManifestUrl: undefined,
  selectedDatasetVersionId: undefined,
  isDatasetLoading: false,
  datasetError: undefined,
  recipeSearch: "",
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
    const enrichedDataset = enrichDatasetRecipes(dataset);
    set((state) => ({
      dataset: enrichedDataset,
      selectedDatasetVersionId: enrichedDataset.datasetVersionId,
      selectedRecipeId:
        state.selectedRecipeId &&
        enrichedDataset.recipes.some((recipe) => recipe.id === state.selectedRecipeId)
          ? state.selectedRecipeId
          : enrichedDataset.recipes[0]?.id,
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

      const duplicate = state.project.edges.some(
        (existing) =>
          existing.source === edge.source &&
          existing.target === edge.target &&
          existing.resourceKind === edge.resourceKind &&
          existing.resourceId === edge.resourceId &&
          existing.sourceHandle === edge.sourceHandle &&
          existing.targetHandle === edge.targetHandle,
      );
      if (duplicate) {
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

function touchProject(project: FactoryProject): FactoryProject {
  return {
    ...project,
    metadata: {
      ...project.metadata,
      updatedAt: new Date().toISOString(),
    },
  };
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
