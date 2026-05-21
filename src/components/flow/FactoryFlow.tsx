"use client";

import {
  Background,
  BaseEdge,
  Controls,
  ConnectionMode,
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
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from "@xyflow/react";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatRate, isRecipeInputConsumed } from "@/lib/model";
import type {
  FactoryEdge,
  FactoryNodeColorTag,
  FactoryProject,
  ResourceAmount,
} from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { RecipeNode, type RecipeFlowNode } from "./RecipeNode";
import { GT_NODE_COLOR_PALETTE } from "./node-colors";
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
  resource: Pick<
    ResourceAmount,
    "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas"
  >;
  color: string;
  demand: string;
  transferred?: string;
  unit: string;
  isLimited: boolean;
  isStorageEdge: boolean;
  showLabel: boolean;
};

type ResourceFlowEdge = Edge<ResourceEdgeData, "resourceEdge">;

type DraggedResourceConnection = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas"
> & {
  nodeId: string;
  side: "input" | "output";
  handleId: string;
};

export function FactoryFlow() {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const selectNode = useFactoryStore((state) => state.selectNode);
  const setNodePosition = useFactoryStore((state) => state.setNodePosition);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const setStoragePosition = useFactoryStore((state) => state.setStoragePosition);
  const connectNodes = useFactoryStore((state) => state.connectNodes);
  const reconnectEdge = useFactoryStore((state) => state.reconnectEdge);
  const addStorageForConnection = useFactoryStore((state) => state.addStorageForConnection);
  const deleteEdge = useFactoryStore((state) => state.deleteEdge);
  const cancelResourceConnection = useFactoryStore((state) => state.cancelResourceConnection);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const setNodeColorPaintMode = useFactoryStore((state) => state.setNodeColorPaintMode);
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
      ...(project.storages ?? []).map(
        (storage) =>
          ({
            id: storage.id,
            type: "storageNode",
            position: storage.position,
            data: {
              storage,
              result: result.storages[storage.id],
            },
          }) satisfies StorageFlowNode,
      ),
    ],
    [project.nodes, project.recipes, project.storages, result.nodes, result.storages],
  );
  const [flowNodes, setFlowNodes] = useState<Array<RecipeFlowNode | StorageFlowNode>>(
    () => nodesFromProject,
  );
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const draggingNodeRef = useRef(false);
  const draggedResourceRef = useRef<DraggedResourceConnection | undefined>(undefined);
  const flowInstanceRef = useRef<ReactFlowInstance<
    RecipeFlowNode | StorageFlowNode,
    ResourceFlowEdge
  > | null>(null);

  useEffect(() => {
    if (draggingNodeRef.current) {
      return;
    }

    setFlowNodes(nodesFromProject);
  }, [nodesFromProject]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<Array<RecipeFlowNode | StorageFlowNode>[number]>[]) => {
      setFlowNodes(
        (currentNodes) =>
          applyNodeChanges(changes, currentNodes) as Array<RecipeFlowNode | StorageFlowNode>,
      );
    },
    [],
  );

  const edges = useMemo<ResourceFlowEdge[]>(
    () =>
      project.edges.map((edge) => {
        const edgeResult = result.edges[edge.id];
        const unit = edge.resourceKind === "fluid" ? "L/s" : "/s";
        const demand = edgeResult?.demandPerSecond ?? edge.ratePerSecond ?? 0;
        const transferred = edgeResult?.transferredPerSecond ?? demand;
        const sourceStorage = (project.storages ?? []).find(
          (storage) => storage.id === edge.source,
        );
        const targetStorage = (project.storages ?? []).find(
          (storage) => storage.id === edge.target,
        );
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

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        const sourceHandle = parseResourceHandleId(connection.sourceHandle);
        const targetHandle = parseResourceHandleId(connection.targetHandle);

        if (
          sourceHandle &&
          targetHandle &&
          sourceHandle.side !== targetHandle.side &&
          sourceHandle.kind === targetHandle.kind &&
          sourceHandle.resourceId === targetHandle.resourceId
        ) {
          const output =
            sourceHandle.side === "output"
              ? {
                  nodeId: connection.source,
                  handleId: connection.sourceHandle ?? undefined,
                  resource: sourceHandle,
                }
              : {
                  nodeId: connection.target,
                  handleId: connection.targetHandle ?? undefined,
                  resource: targetHandle,
                };
          const input =
            sourceHandle.side === "input"
              ? { nodeId: connection.source, handleId: connection.sourceHandle ?? undefined }
              : { nodeId: connection.target, handleId: connection.targetHandle ?? undefined };

          connectNodes(output.nodeId, input.nodeId, {
            kind: output.resource.kind,
            id: output.resource.resourceId,
            sourceHandle: output.handleId,
            targetHandle: input.handleId,
          });
          return;
        }

        if (connection.sourceHandle || connection.targetHandle) {
          return;
        }

        connectNodes(connection.source, connection.target);
      }
    },
    [connectNodes],
  );

  const handleConnectStart = useCallback(
    (_: MouseEvent | TouchEvent, params: { nodeId: string | null; handleId: string | null }) => {
      draggedResourceRef.current =
        params.nodeId && params.handleId
          ? getDraggedResourceForHandle(project, params.nodeId, params.handleId)
          : undefined;
    },
    [project],
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: { toHandle: unknown | null }) => {
      const draggedResource = draggedResourceRef.current;
      draggedResourceRef.current = undefined;

      const flowInstance = flowInstanceRef.current;
      if (!draggedResource || connectionState.toHandle || !flowInstance) {
        return;
      }

      const clientPosition = getClientPosition(event);
      if (!clientPosition) {
        return;
      }

      const position = flowInstance.screenToFlowPosition(clientPosition);
      addStorageForConnection(
        draggedResource,
        draggedResource.nodeId,
        draggedResource.side,
        { x: position.x - 78, y: position.y - 62 },
        draggedResource.handleId,
      );
    },
    [addStorageForConnection],
  );

  const handleReconnect = useCallback(
    (oldEdge: ResourceFlowEdge, connection: Connection) => {
      reconnectEdge(oldEdge.id, connection);
    },
    [reconnectEdge],
  );

  const handleInit = useCallback(
    (instance: ReactFlowInstance<RecipeFlowNode | StorageFlowNode, ResourceFlowEdge>) => {
      flowInstanceRef.current = instance;
    },
    [],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (selectedEdgeIds.length > 0) {
          selectedEdgeIds.forEach((edgeId) => deleteEdge(edgeId));
          setSelectedEdgeIds([]);
          return;
        }
        cancelResourceConnection();
        setNodeColorPaintMode(undefined);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelResourceConnection, deleteEdge, selectedEdgeIds, setNodeColorPaintMode]);

  const handleSelectionChange = useCallback(({ edges: selectedEdges }: OnSelectionChangeParams) => {
    setSelectedEdgeIds(selectedEdges.map((edge) => edge.id));
  }, []);

  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (nodeColorPaintMode !== undefined && node.type === "recipeNode") {
        updateNode(node.id, { colorTag: nodeColorPaintMode ?? undefined });
        return;
      }

      selectNode(node.id);
    },
    [nodeColorPaintMode, selectNode, updateNode],
  );

  const handlePaneClick = useCallback(() => {
    selectNode(undefined);
    cancelResourceConnection();
  }, [cancelResourceConnection, selectNode]);

  const handleNodeDragStart = useCallback(() => {
    draggingNodeRef.current = true;
  }, []);

  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
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
    },
    [setNodePosition, setStoragePosition],
  );

  const handleEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      deletedEdges.forEach((edge) => deleteEdge(edge.id));
    },
    [deleteEdge],
  );

  const fitViewOptions = useMemo(() => ({ padding: 0.18 }), []);

  return (
    <div className="factory-flow-board relative h-full min-h-[520px] overflow-hidden border-x border-neutral-200 bg-neutral-100">
      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onReconnect={handleReconnect}
        onInit={handleInit}
        isValidConnection={isCompatibleResourceConnection}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={18}
        edgesReconnectable
        reconnectRadius={12}
        onNodeClick={handleNodeClick}
        onNodesChange={handleNodesChange}
        onSelectionChange={handleSelectionChange}
        onPaneClick={handlePaneClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onEdgesDelete={handleEdgesDelete}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.15}
        maxZoom={1.8}
      >
        <Background gap={24} color="#d4d4d4" />
        <Controls position="bottom-left" />
      </ReactFlow>
      <PaintToolbar paintMode={nodeColorPaintMode} onPaintModeChange={setNodeColorPaintMode} />
    </div>
  );
}

function PaintToolbar({
  paintMode,
  onPaintModeChange,
}: {
  paintMode?: FactoryNodeColorTag | null;
  onPaintModeChange: (tag: FactoryNodeColorTag | null | undefined) => void;
}) {
  return (
    <div className="nodrag absolute bottom-12 right-3 z-20 grid w-[156px] grid-cols-5 gap-1 border-2 border-[#252525] bg-[#c6c6c6] p-1 shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555]">
      <button
        type="button"
        onClick={() => onPaintModeChange(paintMode === null ? undefined : null)}
        className={[
          "flex h-7 w-7 items-center justify-center border-2 bg-[#7d7d7d] text-white shadow-[inset_1px_1px_0_#d8d8d8,inset_-1px_-1px_0_#404040]",
          paintMode === null ? "border-white" : "border-[#252525]",
        ].join(" ")}
        title="Erase colors"
        aria-label="Erase colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {GT_NODE_COLOR_PALETTE.map((entry) => (
        <button
          key={entry.tag}
          type="button"
          onClick={() => onPaintModeChange(paintMode === entry.tag ? undefined : entry.tag)}
          className={[
            "h-7 w-7 border-2 shadow-[inset_1px_1px_0_rgba(255,255,255,0.45),inset_-1px_-1px_0_rgba(0,0,0,0.45)]",
            paintMode === entry.tag ? "border-white" : "border-[#252525]",
          ].join(" ")}
          style={{ backgroundColor: entry.color.swatch }}
          title={entry.tag}
          aria-label={`Paint ${entry.tag}`}
        />
      ))}
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
  selected,
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
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: selected ? 5 : style?.strokeWidth,
          filter: selected ? "drop-shadow(0 0 4px rgba(34,211,238,0.9))" : undefined,
        }}
      />
      {data?.showLabel ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute flex items-center gap-1 border border-[#252525] bg-[#2b2d32] px-1.5 py-1 text-[11px] font-medium text-white shadow-[inset_1px_1px_0_rgba(255,255,255,0.18),inset_-1px_-1px_0_rgba(0,0,0,0.55)]"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              color: data.isLimited ? "#fecaca" : "#f8fafc",
              borderColor: data.color,
              boxShadow: selected ? "0 0 0 2px rgba(34,211,238,0.9)" : undefined,
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

function isCompatibleResourceConnection(connection: Connection | Edge): boolean {
  const sourceHandle = parseResourceHandleId(connection.sourceHandle);
  const targetHandle = parseResourceHandleId(connection.targetHandle);
  if (!sourceHandle || !targetHandle) {
    return false;
  }

  return (
    sourceHandle.side !== targetHandle.side &&
    sourceHandle.kind === targetHandle.kind &&
    sourceHandle.resourceId === targetHandle.resourceId
  );
}

function getDraggedResourceForHandle(
  project: FactoryProject,
  nodeId: string,
  handleId: string,
): DraggedResourceConnection | undefined {
  const handle = parseResourceHandleId(handleId);
  if (!handle) {
    return undefined;
  }

  const storage = (project.storages ?? []).find((entry) => entry.id === nodeId);
  if (storage) {
    return {
      nodeId,
      side: handle.side,
      handleId,
      kind: storage.kind,
      id: storage.resourceId,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
    };
  }

  const node = project.nodes.find((entry) => entry.id === nodeId);
  const recipe = project.recipes.find((entry) => entry.id === node?.recipeId);
  if (!recipe) {
    return undefined;
  }

  const resources = handle.side === "input" ? recipe.inputs : recipe.outputs;
  const resource = resources.find(
    (entry) => entry.kind === handle.kind && entry.id === handle.resourceId,
  );
  if (!resource || (handle.side === "input" && !isRecipeInputConsumed(resource))) {
    return undefined;
  }

  return {
    nodeId,
    side: handle.side,
    handleId,
    kind: resource.kind,
    id: resource.id,
    displayName: resource.displayName,
    iconPath: resource.iconPath,
    iconAtlas: resource.iconAtlas,
  };
}

function getClientPosition(event: MouseEvent | TouchEvent) {
  if ("changedTouches" in event && event.changedTouches.length > 0) {
    return {
      x: event.changedTouches[0].clientX,
      y: event.changedTouches[0].clientY,
    };
  }

  if ("clientX" in event) {
    return {
      x: event.clientX,
      y: event.clientY,
    };
  }

  return undefined;
}

function getEdgeResource(
  project: FactoryProject,
  edge: FactoryEdge,
): Pick<ResourceAmount, "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas"> {
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
    iconAtlas: output?.iconAtlas ?? storage?.iconAtlas,
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
