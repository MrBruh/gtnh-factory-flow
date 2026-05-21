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
  useReactFlow,
  useStore,
  type Connection,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
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
  sourceSlotEndpoint: boolean;
  targetSlotEndpoint: boolean;
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
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [isNodeDragging, setNodeDragging] = useState(false);
  const draggingNodeRef = useRef(false);
  const draggedResourceRef = useRef<DraggedResourceConnection | undefined>(undefined);
  const lastConnectionPointerRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const connectCompletedRef = useRef(false);
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
            sourceSlotEndpoint: Boolean(sourceHandle),
            targetSlotEndpoint: Boolean(targetHandle),
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

      connectCompletedRef.current = false;
      lastConnectionPointerRef.current = getClientPosition(event);
      draggedResourceRef.current =
        nodeId && handleId ? getDraggedResourceForHandle(project, nodeId, handleId) : undefined;
    },
    [project],
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
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

        if (selectedEdgeIds.length > 0) {
          selectedEdgeIds.forEach((edgeId) => deleteEdge(edgeId));
          setSelectedEdgeIds([]);
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
    selectedNodeId,
    setNodeColorPaintMode,
  ]);

  const handleSelectionChange = useCallback(({ edges: selectedEdges }: OnSelectionChangeParams) => {
    setSelectedEdgeIds(selectedEdges.map((edge) => edge.id));
  }, []);

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
        onInit={handleInit}
        onMoveEnd={updateFlowViewportCenter}
        isValidConnection={isCompatibleResourceConnection}
        connectionLineComponent={ResourceConnectionLine}
        connectionLineStyle={connectionLineStyle}
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
  const resourceColor = useResourceEdgeColor(
    data?.resource,
    data?.color ?? DEFAULT_ITEM_EDGE_COLOR,
  );
  const viewportTransform = useStore((state) => state.transform);
  const [measurementTick, setMeasurementTick] = useState(0);
  const { screenToFlowPosition } = useReactFlow<
    RecipeFlowNode | StorageFlowNode,
    ResourceFlowEdge
  >();
  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setMeasurementTick((tick) => tick + 1);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [viewportTransform]);

  const edgeColor = resourceColor;
  const visualSource = getSlotEdgeEndpoint({
    nodeId: source,
    handleId: sourceHandleId,
    position: sourcePosition,
    fallbackX: sourceX,
    fallbackY: sourceY,
    isRecipeSlotEndpoint: data?.sourceSlotEndpoint,
    screenToFlowPosition,
    viewportTransform,
    measurementTick,
  });
  const visualTarget = getSlotEdgeEndpoint({
    nodeId: target,
    handleId: targetHandleId,
    position: targetPosition,
    fallbackX: targetX,
    fallbackY: targetY,
    isRecipeSlotEndpoint: data?.targetSlotEndpoint,
    screenToFlowPosition,
    viewportTransform,
    measurementTick,
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
  screenToFlowPosition,
  viewportTransform: _viewportTransform,
  measurementTick: _measurementTick,
}: {
  nodeId: string;
  handleId?: string | null;
  position: unknown;
  fallbackX: number;
  fallbackY: number;
  isRecipeSlotEndpoint?: boolean;
  screenToFlowPosition: (clientPosition: { x: number; y: number }) => { x: number; y: number };
  viewportTransform: [number, number, number];
  measurementTick: number;
}) {
  void _viewportTransform;
  void _measurementTick;

  if (!isRecipeSlotEndpoint) {
    return { x: fallbackX, y: fallbackY };
  }

  const domEndpoint = getSlotEdgeEndpointFromDom(nodeId, handleId, position, screenToFlowPosition);
  if (domEndpoint) {
    return domEndpoint;
  }

  switch (String(position)) {
    case "right":
      return { x: fallbackX + RECIPE_SLOT_EDGE_OFFSET, y: fallbackY };
    case "left":
      return { x: fallbackX - RECIPE_SLOT_EDGE_OFFSET, y: fallbackY };
    default:
      return { x: fallbackX, y: fallbackY };
  }
}

function getSlotEdgeEndpointFromDom(
  nodeId: string,
  handleId: string | null | undefined,
  position: unknown,
  screenToFlowPosition: (clientPosition: { x: number; y: number }) => { x: number; y: number },
) {
  if (!handleId || typeof document === "undefined") {
    return undefined;
  }

  const slotElement = [
    ...document.querySelectorAll<HTMLElement>(
      "[data-resource-edge-anchor='true'], [data-resource-handle='true']",
    ),
  ].find(
    (element) =>
      element.dataset.resourceNodeId === nodeId && element.dataset.resourceHandleId === handleId,
  );
  if (!slotElement) {
    return undefined;
  }

  const slotRect = slotElement.getBoundingClientRect();
  const screenX = String(position) === "left" ? slotRect.left : slotRect.right;
  const screenY = slotRect.top + slotRect.height / 2;
  return screenToFlowPosition({ x: screenX, y: screenY });
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

const sampledResourceColorCache = new Map<string, string>();
const pendingResourceColorCache = new Map<string, Promise<string>>();

function useResourceEdgeColor(
  resource: ResourceEdgeData["resource"] | undefined,
  fallbackColor: string,
) {
  const initialColor = resource ? getInitialResourceColor(resource) : fallbackColor;
  const key = getResourceIconColorKey(resource);
  const [sampledColor, setSampledColor] = useState<{
    key: string;
    color: string;
  }>();

  useEffect(() => {
    if (!resource || !key) {
      return;
    }
    if (resource.dominantColor) {
      return;
    }

    let cancelled = false;
    const cachedColor = sampledResourceColorCache.get(key);
    let pendingColor: Promise<string> | undefined = cachedColor
      ? Promise.resolve(cachedColor)
      : pendingResourceColorCache.get(key);

    if (!pendingColor) {
      pendingColor = sampleResourceIconColor(resource)
        .then((sampledColor) => {
          sampledResourceColorCache.set(key, sampledColor);
          pendingResourceColorCache.delete(key);
          return sampledColor;
        })
        .catch(() => {
          pendingResourceColorCache.delete(key);
          return initialColor;
        });
      pendingResourceColorCache.set(key, pendingColor);
    }

    pendingColor.then((sampledColor) => {
      if (!cancelled) {
        setSampledColor({ key, color: sampledColor });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [initialColor, key, resource]);

  if (sampledColor && sampledColor.key === key) {
    return sampledColor.color;
  }

  return initialColor;
}

function getInitialResourceColor(resource: ResourceEdgeData["resource"]) {
  return (
    resource.dominantColor ??
    resource.iconAtlas?.dominantColor ??
    (resource.kind === "fluid" ? DEFAULT_FLUID_EDGE_COLOR : DEFAULT_ITEM_EDGE_COLOR)
  );
}

function getResourceIconColorKey(resource: ResourceEdgeData["resource"] | undefined) {
  if (!resource) {
    return undefined;
  }

  if (resource.iconAtlas) {
    return [
      "atlas",
      resource.iconAtlas.imagePath,
      resource.iconAtlas.x,
      resource.iconAtlas.y,
      resource.iconAtlas.width,
      resource.iconAtlas.height,
    ].join(":");
  }

  return resource.iconPath ? `path:${resource.iconPath}` : undefined;
}

async function sampleResourceIconColor(resource: ResourceEdgeData["resource"]) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return getInitialResourceColor(resource);
  }

  const iconAtlas = resource.iconAtlas;
  const sourcePath = iconAtlas?.imagePath ?? resource.iconPath;
  if (!sourcePath) {
    return getInitialResourceColor(resource);
  }

  const image = await loadImage(sourcePath);
  const canvas = document.createElement("canvas");
  const sampleSize = 32;
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return getInitialResourceColor(resource);
  }

  context.imageSmoothingEnabled = false;
  if (iconAtlas) {
    context.drawImage(
      image,
      iconAtlas.x,
      iconAtlas.y,
      iconAtlas.width,
      iconAtlas.height,
      0,
      0,
      sampleSize,
      sampleSize,
    );
  } else {
    context.drawImage(image, 0, 0, sampleSize, sampleSize);
  }

  return getDominantImageDataColor(context.getImageData(0, 0, sampleSize, sampleSize).data);
}

function loadImage(sourcePath: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = new URL(sourcePath, window.location.origin).toString();
  });
}

function getDominantImageDataColor(data: Uint8ClampedArray) {
  const buckets = new Map<number, { weight: number; red: number; green: number; blue: number }>();

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha < 24) {
      continue;
    }

    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const { hue, saturation, lightness } = rgbToHsl(red, green, blue);
    if (lightness < 0.05 || lightness > 0.96) {
      continue;
    }

    const bucket = Math.round(hue / 12) * 12;
    const weight = (alpha / 255) * (0.35 + saturation * 1.65);
    const current = buckets.get(bucket) ?? { weight: 0, red: 0, green: 0, blue: 0 };
    current.weight += weight;
    current.red += red * weight;
    current.green += green * weight;
    current.blue += blue * weight;
    buckets.set(bucket, current);
  }

  const dominant = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
  if (!dominant || dominant.weight <= 0) {
    return DEFAULT_ITEM_EDGE_COLOR;
  }

  return rgbToHex(
    Math.round(dominant.red / dominant.weight),
    Math.round(dominant.green / dominant.weight),
    Math.round(dominant.blue / dominant.weight),
  );
}

function rgbToHsl(red: number, green: number, blue: number) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { hue: 0, saturation: 0, lightness };
  }

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;

  if (max === r) {
    hue = (g - b) / delta + (g < b ? 6 : 0);
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  return { hue: hue * 60, saturation, lightness };
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("")}`;
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
