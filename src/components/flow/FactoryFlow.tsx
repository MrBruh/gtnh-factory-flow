"use client";

import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  MarkerType,
  ReactFlow,
  applyNodeChanges,
  getSmoothStepPath,
  type Connection,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatRate } from "@/lib/model";
import type { FactoryEdge, FactoryProject, ResourceAmount } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { RecipeNode, type RecipeFlowNode } from "./RecipeNode";
import { parseResourceHandleId } from "./resource-handles";
import { StorageNode, type StorageFlowNode } from "./StorageNode";

const nodeTypes = {
  recipeNode: RecipeNode,
  storageNode: StorageNode,
} satisfies NodeTypes;

const edgeTypes = {
  resourceEdge: ResourceEdge,
} satisfies EdgeTypes;

type ResourceEdgeData = {
  resource: Pick<ResourceAmount, "kind" | "id" | "amount" | "displayName" | "iconPath">;
  color: string;
  demand: string;
  transferred?: string;
  unit: string;
  isLimited: boolean;
  isStorageEdge: boolean;
  showLabel: boolean;
};

type ResourceFlowEdge = Edge<ResourceEdgeData, "resourceEdge">;

export function FactoryFlow() {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const selectNode = useFactoryStore((state) => state.selectNode);
  const setNodePosition = useFactoryStore((state) => state.setNodePosition);
  const setStoragePosition = useFactoryStore((state) => state.setStoragePosition);
  const connectNodes = useFactoryStore((state) => state.connectNodes);
  const deleteEdge = useFactoryStore((state) => state.deleteEdge);
  const pendingResourceConnection = useFactoryStore((state) => state.pendingResourceConnection);
  const cancelResourceConnection = useFactoryStore((state) => state.cancelResourceConnection);
  const hoveredStorageResourceKey = useFactoryStore((state) => state.hoveredStorageResourceKey);
  const recipeSearch = useFactoryStore((state) => state.recipeSearch);

  const nodesFromProject = useMemo<Array<RecipeFlowNode | StorageFlowNode>>(
    () => [
      ...project.nodes.map((node) => {
        const recipe = project.recipes.find((entry) => entry.id === node.recipeId);
        return {
          id: node.id,
          type: "recipeNode",
          position: node.position,
          data: {
            projectNode: node,
            recipe:
              recipe ??
              ({
                id: node.recipeId,
                name: "Missing recipe",
                machineType: "Unknown",
                minimumTier: "DEMO",
                durationTicks: 20,
                eut: 0,
                inputs: [],
                outputs: [],
              } satisfies RecipeFlowNode["data"]["recipe"]),
            result: result.nodes[node.id],
          },
        } satisfies RecipeFlowNode;
      }),
      ...(project.storages ?? []).map((storage) => ({
        id: storage.id,
        type: "storageNode",
        position: storage.position,
        data: {
          storage,
          result: result.storages[storage.id],
        },
      }) satisfies StorageFlowNode),
    ],
    [project.nodes, project.recipes, project.storages, result.nodes, result.storages],
  );
  const [flowNodes, setFlowNodes] = useState<Array<RecipeFlowNode | StorageFlowNode>>(
    () => nodesFromProject,
  );
  const draggingNodeRef = useRef(false);

  useEffect(() => {
    if (draggingNodeRef.current) {
      return;
    }

    setFlowNodes(nodesFromProject);
  }, [nodesFromProject]);

  const handleNodesChange = (changes: NodeChange<Array<RecipeFlowNode | StorageFlowNode>[number]>[]) => {
    setFlowNodes((currentNodes) =>
      applyNodeChanges(changes, currentNodes) as Array<RecipeFlowNode | StorageFlowNode>,
    );
  };

  const edges = useMemo<ResourceFlowEdge[]>(
    () =>
      project.edges.map((edge) => {
        const edgeResult = result.edges[edge.id];
        const unit = edge.resourceKind === "fluid" ? "L/s" : "/s";
        const demand = edgeResult?.demandPerSecond ?? edge.ratePerSecond ?? 0;
        const transferred = edgeResult?.transferredPerSecond ?? demand;
        const sourceStorage = (project.storages ?? []).find((storage) => storage.id === edge.source);
        const targetStorage = (project.storages ?? []).find((storage) => storage.id === edge.target);
        const isStorageEdge = Boolean(sourceStorage || targetStorage);
        const storageResourceKey = sourceStorage
          ? `${sourceStorage.kind}:${sourceStorage.resourceId}`
          : targetStorage
            ? `${targetStorage.kind}:${targetStorage.resourceId}`
            : undefined;
        const edgeColor = edgeResult?.isLimited
          ? "#dc2626"
          : edge.resourceKind === "fluid"
            ? "#0284c7"
            : "#0f766e";
        const resource = getEdgeResource(project, edge);
        const isStorageEdgeActive =
          !isStorageEdge || hoveredStorageResourceKey === storageResourceKey;
        const isSearchEdgeActive = edgeMatchesSearch(edge, resource, recipeSearch);
        const showStorageEdge = isStorageEdgeActive || isSearchEdgeActive;

        return {
          id: edge.id,
          zIndex: 20,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          type: "resourceEdge",
          data: {
            resource,
            color: edgeColor,
            demand: formatRate(demand),
            transferred: edgeResult?.isLimited === true ? formatRate(transferred) : undefined,
            unit,
            isLimited: edgeResult?.isLimited === true,
            isStorageEdge,
            showLabel: isStorageEdge ? showStorageEdge : true,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: edgeColor,
          },
          style: {
            stroke: edgeColor,
            strokeDasharray: edgeResult?.isLimited ? "7 4" : undefined,
            strokeOpacity: isStorageEdge ? (showStorageEdge ? 0.9 : 0.14) : 1,
            strokeWidth: isStorageEdge ? (showStorageEdge ? 2 : 1) : edgeResult?.isLimited ? 3 : 2,
          },
        };
      }),
    [hoveredStorageResourceKey, project, recipeSearch, result.edges],
  );

  const handleConnect = (connection: Connection) => {
    if (connection.source && connection.target) {
      const sourceHandle = parseResourceHandleId(connection.sourceHandle);
      const targetHandle = parseResourceHandleId(connection.targetHandle);

      if (
        sourceHandle?.side === "output" &&
        targetHandle?.side === "input" &&
        sourceHandle.kind === targetHandle.kind &&
        sourceHandle.resourceId === targetHandle.resourceId
      ) {
        connectNodes(connection.source, connection.target, {
          kind: sourceHandle.kind,
          id: sourceHandle.resourceId,
          sourceHandle: connection.sourceHandle ?? undefined,
          targetHandle: connection.targetHandle ?? undefined,
        });
        return;
      }

      if (connection.sourceHandle || connection.targetHandle) {
        return;
      }

      connectNodes(connection.source, connection.target);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelResourceConnection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelResourceConnection]);

  return (
    <div className="factory-flow-board relative h-full min-h-[520px] overflow-hidden border-x border-neutral-200 bg-neutral-100">
      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={handleConnect}
        onNodeClick={(_, node) => selectNode(node.id)}
        onNodesChange={handleNodesChange}
        onPaneClick={() => {
          selectNode(undefined);
          cancelResourceConnection();
        }}
        onNodeDragStart={() => {
          draggingNodeRef.current = true;
        }}
        onNodeDragStop={(_, node: Node) => {
          if (node.type === "storageNode") {
            setStoragePosition(node.id, node.position);
          } else {
            setNodePosition(node.id, node.position);
          }

          draggingNodeRef.current = false;
          setFlowNodes((currentNodes) =>
            currentNodes.map((entry) =>
              entry.id === node.id ? ({ ...entry, position: node.position } as typeof entry) : entry,
            ),
          );
        }}
        onEdgesDelete={(deletedEdges) => deletedEdges.forEach((edge) => deleteEdge(edge.id))}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.15}
        maxZoom={1.8}
      >
        <Background gap={24} color="#d4d4d4" />
        <Controls position="bottom-left" />
      </ReactFlow>
      {pendingResourceConnection ? (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 border-2 border-[#252525] bg-[#c6c6c6] px-3 py-2 text-center text-xs font-medium text-[#202020] shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555]">
          {pendingResourceConnection.side === "output" ? "Output" : "Input"}:{" "}
          {pendingResourceConnection.displayName ?? pendingResourceConnection.resourceId}
          <span className="ml-2 font-normal">click matching slot, Esc to cancel</span>
        </div>
      ) : null}
    </div>
  );
}

function ResourceEdge({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<ResourceFlowEdge>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const rate = data?.isLimited
    ? `${data.transferred}/${data.demand}${data.unit}`
    : `${data?.demand}${data?.unit}`;

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {data?.showLabel ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute flex items-center gap-1 border border-[#252525] bg-[#2b2d32] px-1.5 py-1 text-[11px] font-medium text-white shadow-[inset_1px_1px_0_rgba(255,255,255,0.18),inset_-1px_-1px_0_rgba(0,0,0,0.55)]"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              color: data.isLimited ? "#fecaca" : "#f8fafc",
              borderColor: data.color,
            }}
            title={`${data.resource.displayName ?? data.resource.id}: ${rate}`}
          >
            <ResourceIcon
              resource={data.resource}
              size="sm"
              showAmount={false}
              bare
              className="!h-6 !w-6"
            />
            <span className="leading-none">{rate}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function getEdgeResource(
  project: FactoryProject,
  edge: FactoryEdge,
): Pick<ResourceAmount, "kind" | "id" | "amount" | "displayName" | "iconPath"> {
  const sourceNode = project.nodes.find((node) => node.id === edge.source);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  const sourceStorage = (project.storages ?? []).find((storage) => storage.id === edge.source);
  const targetStorage = (project.storages ?? []).find((storage) => storage.id === edge.target);
  const output = sourceRecipe?.outputs.find(
    (resource) => resource.kind === edge.resourceKind && resource.id === edge.resourceId,
  );
  const storage = sourceStorage ?? targetStorage;

  return {
    kind: edge.resourceKind,
    id: edge.resourceId,
    amount: 1,
    displayName: output?.displayName ?? storage?.displayName ?? edge.label,
    iconPath: output?.iconPath ?? storage?.iconPath,
  };
}

function edgeMatchesSearch(
  edge: FactoryEdge,
  resource: Pick<ResourceAmount, "id" | "displayName">,
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) {
    return false;
  }

  return `${resource.displayName ?? ""} ${resource.id} ${edge.resourceId}`
    .toLowerCase()
    .includes(normalizedQuery);
}
