"use client";

import {
  Background,
  BaseEdge,
  Controls,
  ConnectionMode,
  EdgeLabelRenderer,
  ReactFlow,
  applyNodeChanges,
  getSmoothStepPath,
  type Connection,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type FinalConnectionState,
  type HandleType,
  type Node,
  type NodeChange,
  type NodeTypes,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from "@xyflow/react";
import { Paintbrush, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatRate, isRecipeInputConsumed } from "@/lib/model";
import type {
  FactoryEdge,
  FactoryNodeColorTag,
  FactoryProject,
  ResourceAmount,
  ResourceKind,
} from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { RecipeNode, type RecipeFlowNode } from "./RecipeNode";
import { GT_NODE_COLORS, GT_NODE_COLOR_PALETTE } from "./node-colors";
import { parseResourceHandleId } from "./resource-handles";
import { StorageNode, type StorageFlowNode } from "./StorageNode";

const nodeTypes = {
  recipeNode: RecipeNode,
  storageNode: StorageNode,
} satisfies NodeTypes;

const edgeTypes = {
  resourceEdge: ResourceEdge,
} satisfies EdgeTypes;

const connectionLineStyle = {
  stroke: "#00d9ff",
  strokeWidth: 5,
  strokeOpacity: 0.95,
  filter: "drop-shadow(0 0 5px rgba(0,217,255,0.9))",
};

const DEFAULT_ITEM_EDGE_COLOR = "#8b8f98";
const DEFAULT_FLUID_EDGE_COLOR = "#2f89c5";
const RECIPE_SLOT_EDGE_OFFSET = 20;
const STORAGE_SLOT_EDGE_OFFSET = 55;
type ResourceEdgeData = {
  resource: Pick<
    ResourceAmount,
    "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
  >;
  color: string;
  demand: string;
  transferred?: string;
  unit: string;
  isLimited: boolean;
  isStorageEdge: boolean;
  showLabel: boolean;
  sourceHandleId?: string | null;
  targetHandleId?: string | null;
  sourceSlotEndpoint: boolean;
  targetSlotEndpoint: boolean;
  sourceStorageEndpoint: boolean;
  targetStorageEndpoint: boolean;
};

type ResourceFlowEdge = Edge<ResourceEdgeData, "resourceEdge">;

type DraggedResourceConnection = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
> & {
  nodeId: string;
  side: "input" | "output";
  handleId: string;
};

interface ResolvedResourceHandle {
  nodeId: string;
  handleId: string;
  side: "input" | "output";
  kind: ResourceKind;
  resourceId: string;
}

export function FactoryFlow() {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const selectNode = useFactoryStore((state) => state.selectNode);
  const setNodePosition = useFactoryStore((state) => state.setNodePosition);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const updateStorage = useFactoryStore((state) => state.updateStorage);
  const setStoragePosition = useFactoryStore((state) => state.setStoragePosition);
  const connectNodes = useFactoryStore((state) => state.connectNodes);
  const reconnectEdge = useFactoryStore((state) => state.reconnectEdge);
  const addStorageForConnection = useFactoryStore((state) => state.addStorageForConnection);
  const selectedNodeId = useFactoryStore((state) => state.selectedNodeId);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const deleteStorage = useFactoryStore((state) => state.deleteStorage);
  const deleteEdge = useFactoryStore((state) => state.deleteEdge);
  const cancelResourceConnection = useFactoryStore((state) => state.cancelResourceConnection);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const setNodeColorPaintMode = useFactoryStore((state) => state.setNodeColorPaintMode);
  const setFlowViewportCenter = useFactoryStore((state) => state.setFlowViewportCenter);
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
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [isNodeDragging, setNodeDragging] = useState(false);
  const draggingNodeRef = useRef(false);
  const draggedResourceRef = useRef<DraggedResourceConnection | undefined>(undefined);
  const lastConnectionPointerRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const connectCompletedRef = useRef(false);
  const reconnectingEdgeRef = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);
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
        const resource = getEdgeResource(project, edge);
        const edgeColor = getInitialResourceColor(resource);
        const sourceHandle = parseResourceHandleId(edge.sourceHandle);
        const targetHandle = parseResourceHandleId(edge.targetHandle);
        const isStorageEdgeActive =
          !isStorageEdge || hoveredStorageResourceKey === storageResourceKey;
        const isSearchEdgeActive = edgeMatchesSearch(edge, resource, recipeSearch);
        const isStorageEdgeEmphasized = Boolean(
          isStorageEdge && (isStorageEdgeActive || isSearchEdgeActive),
        );

        return {
          id: edge.id,
          zIndex: isNodeDragging ? 2000 : 20,
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
            showLabel: true,
            sourceHandleId: edge.sourceHandle,
            targetHandleId: edge.targetHandle,
            sourceSlotEndpoint: Boolean(sourceHandle && !sourceStorage),
            targetSlotEndpoint: Boolean(targetHandle && !targetStorage),
            sourceStorageEndpoint: Boolean(sourceHandle && sourceStorage),
            targetStorageEndpoint: Boolean(targetHandle && targetStorage),
          },
          style: {
            stroke: edgeColor,
            strokeDasharray: edgeResult?.isLimited ? "7 4" : undefined,
            strokeOpacity: isStorageEdge ? 0.9 : 1,
            strokeWidth: isStorageEdge
              ? isStorageEdgeEmphasized
                ? 3
                : 2
              : edgeResult?.isLimited
                ? 3
                : 2,
          },
        };
      }),
    [hoveredStorageResourceKey, isNodeDragging, project, recipeSearch, result.edges],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      connectCompletedRef.current = true;
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
    (
      event: MouseEvent | TouchEvent,
      params: { nodeId: string | null; handleId: string | null },
    ) => {
      const eventHandle =
        event.target instanceof Element
          ? readResourceHandleElement(
              event.target.closest<HTMLElement>("[data-resource-handle='true']"),
            )
          : undefined;
      const nodeId = params.nodeId ?? eventHandle?.nodeId;
      const handleId = params.handleId ?? eventHandle?.handleId;
      const isEdgeReconnect =
        reconnectingEdgeRef.current ||
        (event.target instanceof Element &&
          Boolean(event.target.closest(".react-flow__edgeupdater")));

      connectCompletedRef.current = false;
      lastConnectionPointerRef.current = getClientPosition(event);
      draggedResourceRef.current =
        !isEdgeReconnect && nodeId && handleId
          ? getDraggedResourceForHandle(project, nodeId, handleId)
          : undefined;
    },
    [project],
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const isEdgeReconnect = reconnectingEdgeRef.current;
      reconnectingEdgeRef.current = false;
      const draggedResource = draggedResourceRef.current;
      draggedResourceRef.current = undefined;
      const clientPosition = getClientPosition(event) ?? lastConnectionPointerRef.current;
      lastConnectionPointerRef.current = undefined;
      const targetHandle =
        getResourceHandleAtPosition(clientPosition) ??
        getResourceHandleAtPointer(event) ??
        getStorageHandleAtPosition(clientPosition, draggedResource) ??
        getStorageHandleAtPointer(event, draggedResource);

      if (connectCompletedRef.current) {
        return;
      }

      if (isEdgeReconnect) {
        return;
      }

      if (draggedResource && targetHandle) {
        if (isCompatibleDraggedResourceTarget(draggedResource, targetHandle)) {
          const source =
            draggedResource.side === "output"
              ? {
                  nodeId: draggedResource.nodeId,
                  handleId: draggedResource.handleId,
                }
              : {
                  nodeId: targetHandle.nodeId,
                  handleId: targetHandle.handleId,
                };
          const target =
            draggedResource.side === "input"
              ? {
                  nodeId: draggedResource.nodeId,
                  handleId: draggedResource.handleId,
                }
              : {
                  nodeId: targetHandle.nodeId,
                  handleId: targetHandle.handleId,
                };

          connectCompletedRef.current = true;
          connectNodes(source.nodeId, target.nodeId, {
            kind: draggedResource.kind,
            id: draggedResource.id,
            displayName: draggedResource.displayName,
            sourceHandle: source.handleId,
            targetHandle: target.handleId,
          });
        }
        return;
      }

      const flowInstance = flowInstanceRef.current;
      if (
        !draggedResource ||
        connectCompletedRef.current ||
        isPointerOverIncompatibleFlowHandle(event, draggedResource) ||
        !flowInstance
      ) {
        return;
      }

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
    [addStorageForConnection, connectNodes],
  );

  useEffect(() => {
    const updatePointerPosition = (event: PointerEvent | MouseEvent | TouchEvent) => {
      if (!draggedResourceRef.current) {
        return;
      }

      lastConnectionPointerRef.current = getClientPosition(event);
    };

    window.addEventListener("pointermove", updatePointerPosition, { passive: true });
    window.addEventListener("mousemove", updatePointerPosition, { passive: true });
    window.addEventListener("touchmove", updatePointerPosition, { passive: true });
    return () => {
      window.removeEventListener("pointermove", updatePointerPosition);
      window.removeEventListener("mousemove", updatePointerPosition);
      window.removeEventListener("touchmove", updatePointerPosition);
    };
  }, []);

  const handleReconnect = useCallback(
    (oldEdge: ResourceFlowEdge, connection: Connection) => {
      reconnectEdge(oldEdge.id, connection);
    },
    [reconnectEdge],
  );

  const handleReconnectStart = useCallback(() => {
    reconnectingEdgeRef.current = true;
    draggedResourceRef.current = undefined;
  }, []);

  const handleReconnectEnd = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      edge: ResourceFlowEdge,
      _handleType: HandleType,
      connectionState: FinalConnectionState,
    ) => {
      reconnectingEdgeRef.current = false;
      if (connectionState.isValid !== true) {
        deleteEdge(edge.id);
      }
    },
    [deleteEdge],
  );

  const updateFlowViewportCenter = useCallback(() => {
    const instance = flowInstanceRef.current;
    const board = boardRef.current;
    if (!instance || !board) {
      return;
    }

    const rect = board.getBoundingClientRect();
    setFlowViewportCenter(
      instance.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }),
    );
  }, [setFlowViewportCenter]);

  const handleMoveEnd = useCallback(() => {
    updateFlowViewportCenter();
  }, [updateFlowViewportCenter]);

  const handleInit = useCallback(
    (instance: ReactFlowInstance<RecipeFlowNode | StorageFlowNode, ResourceFlowEdge>) => {
      flowInstanceRef.current = instance;
      window.requestAnimationFrame(updateFlowViewportCenter);
      window.setTimeout(updateFlowViewportCenter, 120);
    },
    [updateFlowViewportCenter],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Delete") {
        if (isEditableKeyboardTarget(event.target)) {
          return;
        }

        if (selectedEdgeIds.length > 0 || selectedNodeIds.length > 0) {
          selectedEdgeIds.forEach((edgeId) => deleteEdge(edgeId));
          selectedNodeIds.forEach((nodeId) => {
            if (project.nodes.some((node) => node.id === nodeId)) {
              deleteNode(nodeId);
              return;
            }

            if ((project.storages ?? []).some((storage) => storage.id === nodeId)) {
              deleteStorage(nodeId);
            }
          });
          setSelectedEdgeIds([]);
          setSelectedNodeIds([]);
          selectNode(undefined);
          return;
        }

        if (selectedNodeId) {
          if (project.nodes.some((node) => node.id === selectedNodeId)) {
            deleteNode(selectedNodeId);
            return;
          }

          if ((project.storages ?? []).some((storage) => storage.id === selectedNodeId)) {
            deleteStorage(selectedNodeId);
            selectNode(undefined);
            return;
          }
        }

        cancelResourceConnection();
        setNodeColorPaintMode(undefined);
        return;
      }

      if (event.key === "Escape") {
        if (isEditableKeyboardTarget(event.target)) {
          return;
        }

        cancelResourceConnection();
        setNodeColorPaintMode(undefined);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    cancelResourceConnection,
    deleteEdge,
    deleteNode,
    deleteStorage,
    project.nodes,
    project.storages,
    selectNode,
    selectedEdgeIds,
    selectedNodeIds,
    selectedNodeId,
    setNodeColorPaintMode,
  ]);

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
      setSelectedNodeIds(selectedNodes.map((node) => node.id));
      setSelectedEdgeIds(selectedEdges.map((edge) => edge.id));
    },
    [],
  );

  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (nodeColorPaintMode !== undefined) {
        if (node.type === "recipeNode") {
          updateNode(node.id, { colorTag: nodeColorPaintMode ?? undefined });
          return;
        }

        if (node.type === "storageNode") {
          updateStorage(node.id, { colorTag: nodeColorPaintMode ?? undefined });
          return;
        }

        return;
      }

      selectNode(node.id);
    },
    [nodeColorPaintMode, selectNode, updateNode, updateStorage],
  );

  const handlePaneClick = useCallback(() => {
    selectNode(undefined);
    cancelResourceConnection();
  }, [cancelResourceConnection, selectNode]);

  const handleNodeDragStart = useCallback(() => {
    draggingNodeRef.current = true;
    setNodeDragging(true);
  }, []);

  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === "storageNode") {
        setStoragePosition(node.id, node.position);
      } else {
        setNodePosition(node.id, node.position);
      }

      draggingNodeRef.current = false;
      setNodeDragging(false);
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
    <div
      ref={boardRef}
      className={[
        "factory-flow-board relative h-full min-h-[520px] overflow-hidden border-x border-neutral-200 bg-neutral-100",
        isNodeDragging ? "factory-flow-board--dragging" : "",
      ].join(" ")}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onReconnect={handleReconnect}
        onReconnectStart={handleReconnectStart}
        onReconnectEnd={handleReconnectEnd}
        onInit={handleInit}
        onMoveEnd={handleMoveEnd}
        isValidConnection={isCompatibleResourceConnection}
        connectionLineComponent={ResourceConnectionLine}
        connectionLineStyle={connectionLineStyle}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={18}
        elevateNodesOnSelect={false}
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
  const activeColor = paintMode ? GT_NODE_COLORS[paintMode] : undefined;
  const [isPaletteOpen, setPaletteOpen] = useState(false);

  return (
    <div
      className="nodrag pointer-events-none absolute bottom-12 right-3 z-20 flex items-end"
      onMouseEnter={() => setPaletteOpen(true)}
      onMouseLeave={() => setPaletteOpen(false)}
    >
      <div
        className={[
          "mr-0 grid w-[156px] grid-cols-5 gap-1 border-2 border-[#252525] bg-[#c6c6c6] p-1 shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555] transition-[opacity,transform] duration-100",
          isPaletteOpen
            ? "pointer-events-auto translate-x-0 opacity-100"
            : "pointer-events-none translate-x-2 opacity-0",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => onPaintModeChange(paintMode === null ? undefined : null)}
          className={[
            "flex h-7 w-7 items-center justify-center border-2 bg-[#7d7d7d] text-white shadow-[inset_1px_1px_0_#d8d8d8,inset_-1px_-1px_0_#404040]",
            paintMode === null ? "border-white ring-2 ring-cyan-300" : "border-[#252525]",
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
              paintMode === entry.tag ? "border-white ring-2 ring-cyan-300" : "border-[#252525]",
            ].join(" ")}
            style={{ backgroundColor: entry.color.swatch }}
            title={entry.tag}
            aria-label={`Paint ${entry.tag}`}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          if (paintMode !== undefined) {
            onPaintModeChange(undefined);
          }
        }}
        className={[
          "pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[#252525] bg-[#7d7d7d] text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040]",
          paintMode !== undefined ? "ring-2 ring-cyan-300" : "",
        ].join(" ")}
        title={paintMode !== undefined ? "Stop painting" : "Paint nodes"}
        aria-label={paintMode !== undefined ? "Stop painting" : "Paint nodes"}
      >
        {paintMode === undefined ? (
          <Paintbrush className="h-4 w-4" />
        ) : paintMode === null ? (
          <X className="h-4 w-4" />
        ) : (
          <span
            className="h-5 w-5 border-2 border-[#252525] shadow-[inset_1px_1px_0_rgba(255,255,255,0.45),inset_-1px_-1px_0_rgba(0,0,0,0.45)]"
            style={{ backgroundColor: activeColor?.swatch }}
          />
        )}
      </button>
    </div>
  );
}

function ResourceEdge({
  sourceX,
  sourceY,
  sourcePosition,
  source,
  sourceHandleId,
  targetX,
  targetY,
  targetPosition,
  target,
  targetHandleId,
  style,
  selected,
  data,
}: EdgeProps<ResourceFlowEdge>) {
  const resourceColor = data?.resource
    ? getInitialResourceColor(data.resource)
    : (data?.color ?? DEFAULT_ITEM_EDGE_COLOR);
  const edgeColor = resourceColor;
  const visualSource = getSlotEdgeEndpoint({
    nodeId: source,
    handleId: data?.sourceHandleId ?? sourceHandleId,
    position: sourcePosition,
    fallbackX: sourceX,
    fallbackY: sourceY,
    isRecipeSlotEndpoint: data?.sourceSlotEndpoint,
    isStorageSlotEndpoint: data?.sourceStorageEndpoint,
    preferredSide: "source",
  });
  const visualTarget = getSlotEdgeEndpoint({
    nodeId: target,
    handleId: data?.targetHandleId ?? targetHandleId,
    position: targetPosition,
    fallbackX: targetX,
    fallbackY: targetY,
    isRecipeSlotEndpoint: data?.targetSlotEndpoint,
    isStorageSlotEndpoint: data?.targetStorageEndpoint,
    preferredSide: "target",
  });
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX: visualSource.x,
    sourceY: visualSource.y,
    sourcePosition,
    targetX: visualTarget.x,
    targetY: visualTarget.y,
    targetPosition,
  });

  const rate = formatEdgeRateLabel(data);

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          ...style,
          stroke: edgeColor,
          strokeWidth: selected ? 5 : style?.strokeWidth,
          filter: selected ? "drop-shadow(0 0 4px rgba(34,211,238,0.9))" : undefined,
        }}
      />
      <polygon
        points={getArrowHeadPoints(visualTarget.x, visualTarget.y, targetPosition)}
        fill={edgeColor}
        stroke="#252525"
        strokeWidth={selected ? 1.4 : 0.8}
        style={{
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
              borderColor: edgeColor,
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

function ResourceConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionStatus,
}: ConnectionLineComponentProps<RecipeFlowNode | StorageFlowNode>) {
  const [edgePath] = getSmoothStepPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  });
  const color = connectionStatus === "invalid" ? "#ef4444" : "#00d9ff";

  return (
    <g className="react-flow__connection">
      <path
        d={edgePath}
        fill="none"
        stroke="#052e36"
        strokeWidth={9}
        strokeLinecap="round"
        opacity={0.75}
      />
      <path
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeLinecap="round"
        opacity={0.98}
        style={{ filter: `drop-shadow(0 0 5px ${color})` }}
      />
      <circle cx={toX} cy={toY} r={6} fill={color} stroke="#052e36" strokeWidth={2} />
    </g>
  );
}

function getSlotEdgeEndpoint({
  nodeId,
  handleId,
  position,
  fallbackX,
  fallbackY,
  isRecipeSlotEndpoint,
  isStorageSlotEndpoint,
  preferredSide,
}: {
  nodeId: string;
  handleId?: string | null;
  position: unknown;
  fallbackX: number;
  fallbackY: number;
  isRecipeSlotEndpoint?: boolean;
  isStorageSlotEndpoint?: boolean;
  preferredSide: "source" | "target";
}) {
  if (!isRecipeSlotEndpoint && !isStorageSlotEndpoint) {
    return { x: fallbackX, y: fallbackY };
  }

  const edgeSide = isStorageSlotEndpoint
    ? preferredSide === "source"
      ? "right"
      : "left"
    : String(position);

  const measuredEndpoint = getMeasuredSlotEndpoint({
    nodeId,
    handleId,
    edgeSide,
  });
  if (measuredEndpoint) {
    return measuredEndpoint;
  }

  const offset = isStorageSlotEndpoint ? STORAGE_SLOT_EDGE_OFFSET : RECIPE_SLOT_EDGE_OFFSET;

  switch (edgeSide) {
    case "right":
      return { x: fallbackX + (isStorageSlotEndpoint ? -offset : offset), y: fallbackY };
    case "left":
      return { x: fallbackX + (isStorageSlotEndpoint ? offset : -offset), y: fallbackY };
    default:
      return { x: fallbackX, y: fallbackY };
  }
}

function getMeasuredSlotEndpoint({
  nodeId,
  handleId,
  edgeSide,
}: {
  nodeId: string;
  handleId?: string | null;
  edgeSide: string;
}) {
  if (!handleId || typeof document === "undefined") {
    return undefined;
  }

  const slotElement =
    findResourceEndpointElement("[data-resource-edge-anchor='true']", nodeId, handleId) ??
    findResourceEndpointElement("[data-resource-handle='true']", nodeId, handleId);
  const nodeElement =
    slotElement?.closest<HTMLElement>(".react-flow__node") ??
    document.querySelector<HTMLElement>(`.react-flow__node[data-id="${cssEscape(nodeId)}"]`);

  if (!nodeElement || !slotElement) {
    return undefined;
  }

  const slotRect = slotElement.getBoundingClientRect();
  const screenPoint = {
    x: edgeSide === "right" ? slotRect.right : slotRect.left,
    y: slotRect.top + slotRect.height / 2,
  };

  return screenToFlowPoint(screenPoint, nodeElement);
}

function screenToFlowPoint(point: { x: number; y: number }, element: HTMLElement) {
  const viewport = element.closest<HTMLElement>(".react-flow__viewport");
  const renderer = element.closest<HTMLElement>(".react-flow__renderer");
  if (!viewport || !renderer) {
    return undefined;
  }

  const rendererRect = renderer.getBoundingClientRect();
  const transform = parseCssMatrix(getComputedStyle(viewport).transform);
  return {
    x: (point.x - rendererRect.left - transform.translateX) / transform.scaleX,
    y: (point.y - rendererRect.top - transform.translateY) / transform.scaleY,
  };
}

function parseCssMatrix(transform: string) {
  if (!transform || transform === "none") {
    return { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
  }

  const values = transform
    .match(/matrix(?:3d)?\(([^)]+)\)/)?.[1]
    ?.split(",")
    .map((value) => Number.parseFloat(value.trim()));

  if (!values || values.some((value) => !Number.isFinite(value))) {
    return { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
  }

  if (values.length === 16) {
    return {
      scaleX: values[0] || 1,
      scaleY: values[5] || values[0] || 1,
      translateX: values[12] ?? 0,
      translateY: values[13] ?? 0,
    };
  }

  return {
    scaleX: values[0] || 1,
    scaleY: values[3] || values[0] || 1,
    translateX: values[4] ?? 0,
    translateY: values[5] ?? 0,
  };
}

function findResourceEndpointElement(selector: string, nodeId: string, handleId: string) {
  return [...document.querySelectorAll<HTMLElement>(selector)].find(
    (element) =>
      element.dataset.resourceNodeId === nodeId && element.dataset.resourceHandleId === handleId,
  );
}

function cssEscape(value: string) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

function formatEdgeRateLabel(data: ResourceEdgeData | undefined) {
  if (!data) {
    return "";
  }

  const visibleRate =
    data.isLimited && data.transferred !== undefined ? data.transferred : data.demand;
  return `${formatEdgeValue(visibleRate)} ${data.unit}`;
}

function formatEdgeValue(valueText: string) {
  const value = Number(valueText);
  if (!Number.isFinite(value)) {
    return valueText;
  }

  return trimEdgeNumber(value);
}

function trimEdgeNumber(value: number) {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

function isPointerOverIncompatibleFlowHandle(
  event: MouseEvent | TouchEvent,
  draggedResource: DraggedResourceConnection,
) {
  const position = getClientPosition(event);
  if (!position || typeof document === "undefined") {
    return false;
  }

  return document.elementsFromPoint(position.x, position.y).some((element) => {
    const handleElement = element.closest<HTMLElement>(".react-flow__handle");
    if (!handleElement) {
      return false;
    }

    const resourceHandle = readResourceHandleElement(handleElement);
    if (!resourceHandle) {
      return true;
    }

    return !isCompatibleDraggedResourceTarget(draggedResource, resourceHandle);
  });
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function getResourceHandleAtPointer(event: MouseEvent | TouchEvent) {
  const position = getClientPosition(event);
  return getResourceHandleAtPosition(position, event);
}

function getResourceHandleAtPosition(
  position: { x: number; y: number } | undefined,
  fallbackEvent?: MouseEvent | TouchEvent,
) {
  if (!position || typeof document === "undefined") {
    return undefined;
  }

  const geometricMatch = findResourceHandleByGeometry(position);
  if (geometricMatch) {
    return geometricMatch;
  }

  if (fallbackEvent) {
    for (const element of document.elementsFromPoint(position.x, position.y)) {
      const match = readResourceHandleElement(
        element.closest<HTMLElement>("[data-resource-handle='true']"),
      );
      if (match) {
        return match;
      }
    }
  }

  return undefined;
}

function findResourceHandleByGeometry(position: { x: number; y: number }) {
  if (typeof document === "undefined") {
    return undefined;
  }

  const matches = [...document.querySelectorAll<HTMLElement>("[data-resource-handle='true']")]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      if (
        position.x < rect.left ||
        position.x > rect.right ||
        position.y < rect.top ||
        position.y > rect.bottom
      ) {
        return undefined;
      }

      const handle = readResourceHandleElement(element);
      if (!handle) {
        return undefined;
      }

      return {
        handle,
        area: rect.width * rect.height,
      };
    })
    .filter(
      (
        match,
      ): match is { handle: ReturnType<typeof readResourceHandleElement> & {}; area: number } =>
        Boolean(match),
    )
    .sort((left, right) => left.area - right.area);

  return matches[0]?.handle;
}

function readResourceHandleElement(element: HTMLElement | null) {
  const nodeId = element?.dataset.resourceNodeId;
  const handleId = element?.dataset.resourceHandleId;
  const handle = parseResourceHandleId(handleId);

  if (nodeId && handleId && handle) {
    return {
      nodeId,
      handleId,
      side: handle.side,
      kind: handle.kind,
      resourceId: handle.resourceId,
    } satisfies ResolvedResourceHandle;
  }

  return undefined;
}

function isCompatibleDraggedResourceTarget(
  draggedResource: DraggedResourceConnection,
  targetHandle: ResolvedResourceHandle,
) {
  return (
    draggedResource.nodeId !== targetHandle.nodeId &&
    draggedResource.side !== targetHandle.side &&
    draggedResource.kind === targetHandle.kind &&
    draggedResource.id === targetHandle.resourceId
  );
}

function getStorageHandleAtPointer(
  event: MouseEvent | TouchEvent,
  draggedResource: DraggedResourceConnection | undefined,
) {
  const position = getClientPosition(event);
  return getStorageHandleAtPosition(position, draggedResource, event);
}

function getStorageHandleAtPosition(
  position: { x: number; y: number } | undefined,
  draggedResource: DraggedResourceConnection | undefined,
  fallbackEvent?: MouseEvent | TouchEvent,
) {
  if (!position || !draggedResource || typeof document === "undefined") {
    return undefined;
  }

  const storageElements = [
    ...document.querySelectorAll<HTMLElement>("[data-storage-node-id]"),
    ...(fallbackEvent
      ? document
          .elementsFromPoint(position.x, position.y)
          .map((element) => element.closest<HTMLElement>("[data-storage-node-id]"))
          .filter((element): element is HTMLElement => Boolean(element))
      : []),
  ];

  for (const storageElement of storageElements) {
    const rect = storageElement.getBoundingClientRect();
    if (
      position.x < rect.left ||
      position.x > rect.right ||
      position.y < rect.top ||
      position.y > rect.bottom
    ) {
      continue;
    }

    const nodeId = storageElement?.dataset.storageNodeId;
    const kind = storageElement?.dataset.storageKind;
    const resourceId = storageElement?.dataset.storageResourceId;

    if (
      nodeId &&
      nodeId !== draggedResource.nodeId &&
      (kind === "item" || kind === "fluid") &&
      kind === draggedResource.kind &&
      resourceId === draggedResource.id
    ) {
      const side = draggedResource.side === "output" ? "input" : "output";
      return {
        nodeId,
        handleId: `${side}:${kind}:${encodeURIComponent(resourceId)}`,
        side,
        kind,
        resourceId,
      } satisfies ResolvedResourceHandle;
    }
  }

  return undefined;
}

function getInitialResourceColor(resource: ResourceEdgeData["resource"]) {
  return (
    resource.dominantColor ??
    resource.iconAtlas?.dominantColor ??
    (resource.kind === "fluid" ? DEFAULT_FLUID_EDGE_COLOR : DEFAULT_ITEM_EDGE_COLOR)
  );
}

function getArrowHeadPoints(targetX: number, targetY: number, targetPosition: unknown) {
  const length = 11;
  const width = 6;

  switch (String(targetPosition)) {
    case "right":
      return `${targetX},${targetY} ${targetX + length},${targetY - width} ${targetX + length},${targetY + width}`;
    case "top":
      return `${targetX},${targetY} ${targetX - width},${targetY - length} ${targetX + width},${targetY - length}`;
    case "bottom":
      return `${targetX},${targetY} ${targetX - width},${targetY + length} ${targetX + width},${targetY + length}`;
    case "left":
    default:
      return `${targetX},${targetY} ${targetX - length},${targetY - width} ${targetX - length},${targetY + width}`;
  }
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
      dominantColor: storage.dominantColor ?? storage.iconAtlas?.dominantColor,
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
    dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
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
): Pick<
  ResourceAmount,
  "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
> {
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
    dominantColor:
      output?.dominantColor ??
      storage?.dominantColor ??
      output?.iconAtlas?.dominantColor ??
      storage?.iconAtlas?.dominantColor,
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
