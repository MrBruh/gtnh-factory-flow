"use client";

import {
  Background,
  BaseEdge,
  Controls,
  ConnectionMode,
  EdgeLabelRenderer,
  Position,
  ReactFlow,
  applyNodeChanges,
  getNodesBounds,
  getSmoothStepPath,
  getViewportForBounds,
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
  useStore,
} from "@xyflow/react";
import { toBlob, toSvg } from "html-to-image";
import { LoaderCircle, Paintbrush, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  FLOW_IMAGE_EXPORT_COMPLETE_EVENT,
  FLOW_IMAGE_EXPORT_EVENT,
  dataUrlToText,
  embedProjectJsonInPng,
  embedProjectJsonInSvg,
} from "@/lib/import-export/plan-image";
import {
  formatRate,
  isRecipeInputConsumed,
  makeResourceKey,
  resourceMatchesInput,
} from "@/lib/model";
import type {
  FactoryEdge,
  FactoryNodeColorTag,
  FactoryProject,
  Recipe,
  ResourceAmount,
  ResourceKind,
} from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { RecipeNode, type RecipeFlowNode } from "./RecipeNode";
import { GT_NODE_COLORS, GT_NODE_COLOR_PALETTE } from "./node-colors";
import { makeResourceHandleId, parseResourceHandleId } from "./resource-handles";
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
const EDGE_BUNDLE_CLEARANCE = 30;
const DIRECT_EDGE_NODE_CLEARANCE = 18;
const EDGE_LANE_SPACING = 8;
const EDGE_LANE_BUCKETS = 4;
const EDGE_ARROW_SPACING = 5;
const EDGE_ARROW_BUCKETS = 5;
const EDGE_PATH_SPREAD_SPACING = 3;
const EDGE_PATH_SPREAD_BUCKETS = 5;
const EDGE_LABEL_ZOOM = 0.78;
const EDGE_ARROW_ZOOM = 0.72;
const EXPORT_IMAGE_PADDING = 80;
const EXPORT_PNG_PIXEL_RATIO = 2;
const FLOW_EDGE_LABEL_SELECT_EVENT = "gtnh-flow.edge-label-select";
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
  labelOffset?: { x: number; y: number };
  sourceHandleId?: string | null;
  targetHandleId?: string | null;
  sourceSlotEndpoint: boolean;
  targetSlotEndpoint: boolean;
  sourceStorageEndpoint: boolean;
  targetStorageEndpoint: boolean;
  bundle?: {
    role: "primary" | "member";
    mode: "single-target" | "multi-target";
    size: number;
    sourceHandleIds: string[];
    primarySourceHandleId: string;
    edgeIds: string[];
    demand?: string;
    transferred?: string;
    isLimited: boolean;
  };
  isFlowHighlighted?: boolean;
};

type ResourceFlowEdge = Edge<ResourceEdgeData, "resourceEdge">;

type DraggedResourceConnection = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "alternatives"
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
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const hoveredNodeBottlenecks = useFactoryStore((state) => state.hoveredNodeBottlenecks);
  const selectedNodeBottlenecks = useFactoryStore((state) => state.selectedNodeBottlenecks);
  const recipeSearch = useFactoryStore((state) => state.recipeSearch);
  const isProjectImporting = useFactoryStore((state) => state.isProjectImporting);
  const activeFlowResourceKey = hoveredFlowResourceKey ?? selectedFlowResourceKey;
  const activeNodeBottlenecks = hoveredNodeBottlenecks || selectedNodeBottlenecks;

  const nodesFromProject = useMemo<Array<RecipeFlowNode | StorageFlowNode>>(
    () => [
      ...project.nodes.map((node) => {
        const recipe = project.recipes.find((entry) => entry.id === node.recipeId);
        return {
          id: node.id,
          type: "recipeNode",
          position: node.position,
          zIndex:
            activeNodeBottlenecks && result.nodes[node.id]?.status === "bottleneck"
              ? 1500
              : activeFlowResourceKey && recipeContainsResourceKey(recipe, activeFlowResourceKey)
                ? 1500
                : undefined,
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
            zIndex:
              activeFlowResourceKey === makeResourceKey(storage.kind, storage.resourceId)
                ? 1500
                : undefined,
            data: {
              storage,
              result: result.storages[storage.id],
            },
          }) satisfies StorageFlowNode,
      ),
    ],
    [
      activeFlowResourceKey,
      activeNodeBottlenecks,
      project.nodes,
      project.recipes,
      project.storages,
      result.nodes,
      result.storages,
    ],
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
  const exportInProgressRef = useRef(false);
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

  const edges = useMemo<ResourceFlowEdge[]>(() => {
    const edgeBundles = getEdgeBundles(project, project.edges, result.edges);

    return project.edges.map((edge) => {
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
      const isFlowHighlighted =
        activeFlowResourceKey === makeResourceKey(edge.resourceKind, edge.resourceId);

      return {
        id: edge.id,
        zIndex: isNodeDragging ? 2000 : isFlowHighlighted ? 1200 : 20,
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
          labelOffset: edge.labelOffset,
          sourceHandleId: edge.sourceHandle,
          targetHandleId: edge.targetHandle,
          sourceSlotEndpoint: Boolean(sourceHandle && !sourceStorage),
          targetSlotEndpoint: Boolean(targetHandle && !targetStorage),
          sourceStorageEndpoint: Boolean(sourceHandle && sourceStorage),
          targetStorageEndpoint: Boolean(targetHandle && targetStorage),
          bundle: edgeBundles.get(edge.id),
          isFlowHighlighted,
        },
        style: {
          stroke: edgeColor,
          strokeDasharray: edgeResult?.isLimited ? "4 6" : undefined,
          strokeOpacity: isFlowHighlighted
            ? 1
            : edgeResult?.isLimited
              ? 0.58
              : isStorageEdge
                ? 0.86
                : 0.92,
          strokeWidth: isFlowHighlighted
            ? 5
            : isStorageEdge
              ? isStorageEdgeEmphasized
                ? 3.5
                : 2.6
              : edgeResult?.isLimited
                ? 2.2
                : edge.resourceKind === "fluid"
                  ? 2.8
                  : 2.35,
        },
      };
    });
  }, [
    activeFlowResourceKey,
    hoveredStorageResourceKey,
    isNodeDragging,
    project,
    recipeSearch,
    result.edges,
  ]);

  const connectResourceEdges = useCallback(
    (
      sourceNodeId: string,
      targetNodeId: string,
      resource?: Pick<ResourceAmount, "kind" | "id" | "displayName"> & {
        sourceHandle?: string;
        targetHandle?: string;
      },
    ) => {
      const sourceHandleIds =
        resource?.sourceHandle && resource.kind && resource.id
          ? getRepeatedOutputHandleIds(project, sourceNodeId, resource)
          : [];
      const shouldBatchRepeatedOutputs =
        resource?.sourceHandle &&
        sourceHandleIds.length > 1 &&
        sourceHandleIds.includes(resource.sourceHandle);

      if (!resource || !shouldBatchRepeatedOutputs) {
        connectNodes(sourceNodeId, targetNodeId, resource);
        return;
      }

      const allRepeatedEdgesExist = sourceHandleIds.every((sourceHandle) =>
        project.edges.some(
          (edge) =>
            edge.source === sourceNodeId &&
            edge.target === targetNodeId &&
            edge.resourceKind === resource.kind &&
            edge.resourceId === resource.id &&
            edge.sourceHandle === sourceHandle &&
            edge.targetHandle === resource.targetHandle,
        ),
      );

      for (const sourceHandle of sourceHandleIds) {
        const alreadyExists = project.edges.some(
          (edge) =>
            edge.source === sourceNodeId &&
            edge.target === targetNodeId &&
            edge.resourceKind === resource.kind &&
            edge.resourceId === resource.id &&
            edge.sourceHandle === sourceHandle &&
            edge.targetHandle === resource.targetHandle,
        );

        if (!allRepeatedEdgesExist && alreadyExists) {
          continue;
        }

        connectNodes(sourceNodeId, targetNodeId, {
          ...resource,
          sourceHandle,
        });
      }
    },
    [connectNodes, project],
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

          connectResourceEdges(output.nodeId, input.nodeId, {
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

        connectResourceEdges(connection.source, connection.target);
      }
    },
    [connectResourceEdges],
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
        if (isCompatibleDraggedResourceTarget(project, draggedResource, targetHandle)) {
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
          const outputResource =
            draggedResource.side === "output"
              ? draggedResource
              : getResourceForHandle(project, targetHandle.nodeId, targetHandle.handleId);

          if (!outputResource) {
            return;
          }

          connectCompletedRef.current = true;
          connectResourceEdges(source.nodeId, target.nodeId, {
            kind: outputResource.kind,
            id: outputResource.id,
            displayName: outputResource.displayName,
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
        isPointerOverIncompatibleFlowHandle(project, event, draggedResource) ||
        !flowInstance
      ) {
        return;
      }

      if (!clientPosition) {
        return;
      }

      if ((project.storages ?? []).some((storage) => storage.id === draggedResource.nodeId)) {
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
    [addStorageForConnection, connectResourceEdges, project],
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

  const exportFlowImage = useCallback(
    async (format: "svg" | "png", requestId: string, fileName: string, projectJson: string) => {
      if (exportInProgressRef.current) {
        dispatchImageExportComplete(requestId);
        return;
      }

      const viewportElement = boardRef.current?.querySelector<HTMLElement>(".react-flow__viewport");

      if (!viewportElement) {
        dispatchImageExportComplete(requestId);
        return;
      }

      exportInProgressRef.current = true;
      await nextAnimationFrame();

      const nodesBounds = getNodesBounds(flowNodes);
      const imageWidth = getExportImageSize(nodesBounds.width);
      const imageHeight = getExportImageSize(nodesBounds.height);
      const viewport = getViewportForBounds(
        nodesBounds,
        imageWidth,
        imageHeight,
        0.15,
        1.8,
        EXPORT_IMAGE_PADDING / Math.max(imageWidth, imageHeight),
      );
      const options = {
        backgroundColor: "#f5f5f5",
        width: imageWidth,
        height: imageHeight,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        },
      };

      try {
        if (format === "svg") {
          const svgText = embedProjectJsonInSvg(
            dataUrlToText(
              await toSvg(viewportElement, {
                ...options,
                filter: exportNodeFilter,
                skipFonts: true,
              }),
            ),
            projectJson,
          );
          downloadBlob(new Blob([svgText], { type: "image/svg+xml" }), `${fileName}.svg`);
          return;
        }

        const imageBlob = await toBlob(viewportElement, {
          ...options,
          filter: exportNodeFilter,
          pixelRatio: EXPORT_PNG_PIXEL_RATIO,
          skipFonts: true,
        });
        if (!imageBlob) {
          return;
        }

        const pngBlob = await embedProjectJsonInPng(imageBlob, projectJson);
        downloadBlob(pngBlob, `${fileName}.png`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Plan image export failed.");
      } finally {
        exportInProgressRef.current = false;
        dispatchImageExportComplete(requestId);
      }
    },
    [flowNodes],
  );

  useEffect(() => {
    const handleExportImage = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { format?: unknown; requestId?: unknown; fileName?: unknown; projectJson?: unknown }
        | undefined;

      if (
        (detail?.format !== "svg" && detail?.format !== "png") ||
        typeof detail.requestId !== "string" ||
        typeof detail.fileName !== "string" ||
        typeof detail.projectJson !== "string"
      ) {
        return;
      }

      void exportFlowImage(detail.format, detail.requestId, detail.fileName, detail.projectJson);
    };

    window.addEventListener(FLOW_IMAGE_EXPORT_EVENT, handleExportImage);
    return () => window.removeEventListener(FLOW_IMAGE_EXPORT_EVENT, handleExportImage);
  }, [exportFlowImage]);

  useEffect(() => {
    const handleEdgeLabelSelect = (event: Event) => {
      const detail = (event as CustomEvent).detail as { edgeIds?: unknown } | undefined;
      if (
        !Array.isArray(detail?.edgeIds) ||
        !detail.edgeIds.every((edgeId) => typeof edgeId === "string")
      ) {
        return;
      }

      setSelectedEdgeIds(detail.edgeIds);
      setSelectedNodeIds([]);
      selectNode(undefined);
    };

    window.addEventListener(FLOW_EDGE_LABEL_SELECT_EVENT, handleEdgeLabelSelect);
    return () => window.removeEventListener(FLOW_EDGE_LABEL_SELECT_EVENT, handleEdgeLabelSelect);
  }, [selectNode]);

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

      const selectedRecipeNode = [...selectedNodes]
        .reverse()
        .find((node) => node.type === "recipeNode");
      selectNode(selectedRecipeNode?.id);
    },
    [selectNode],
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
        onInit={handleInit}
        onMoveEnd={handleMoveEnd}
        isValidConnection={isCompatibleResourceConnection}
        connectionLineComponent={ResourceConnectionLine}
        connectionLineStyle={connectionLineStyle}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={18}
        elevateNodesOnSelect={false}
        edgesReconnectable={false}
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
      {isProjectImporting ? <FlowLoadingOverlay /> : null}
    </div>
  );
}

function FlowLoadingOverlay() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto absolute inset-0 z-50 grid place-items-center bg-neutral-950/18 backdrop-blur-[1px]"
    >
      <div className="flex items-center gap-3 border-2 border-[#252525] bg-[#c6c6c6] px-4 py-3 text-sm font-semibold text-[#1f1f1f] shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555,4px_4px_0_rgba(0,0,0,0.18)]">
        <LoaderCircle className="h-5 w-5 animate-spin" />
        <span>Loading flowchart...</span>
      </div>
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
  id,
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
  const updateEdge = useFactoryStore((state) => state.updateEdge);
  const zoom = useStore((store) => store.transform[2]);
  const storedLabelOffsetX = data?.labelOffset?.x ?? 0;
  const storedLabelOffsetY = data?.labelOffset?.y ?? 0;
  const storedLabelOffset = { x: storedLabelOffsetX, y: storedLabelOffsetY };
  const [draftLabelOffset, setDraftLabelOffset] = useState(storedLabelOffset);
  const [isLabelDragging, setLabelDragging] = useState(false);
  const labelDragRef = useRef<
    | {
        pointerId: number;
        clientX: number;
        clientY: number;
        offset: { x: number; y: number };
      }
    | undefined
  >(undefined);
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
    counterpartX: targetX,
    counterpartY: targetY,
  });
  const visualTarget = getSlotEdgeEndpoint({
    nodeId: target,
    handleId: data?.targetHandleId ?? targetHandleId,
    position: targetPosition,
    fallbackX: targetX,
    fallbackY: targetY,
    isRecipeSlotEndpoint: data?.targetSlotEndpoint,
    isStorageSlotEndpoint: data?.targetStorageEndpoint,
    counterpartX: sourceX,
    counterpartY: sourceY,
  });
  const rate = data?.bundle?.demand
    ? `${formatEdgeValue(data.bundle.demand)} ${data.unit}`
    : formatEdgeRateLabel(data);
  const isGlobalView = zoom < 0.45;
  const isHiddenBundleMember =
    data?.bundle?.role === "member" && data.bundle.mode === "single-target";
  const showLabel = Boolean(
    data?.showLabel &&
    !isHiddenBundleMember &&
    (selected || data.isFlowHighlighted || zoom >= EDGE_LABEL_ZOOM),
  );
  const isHighlighted = selected || data?.isFlowHighlighted === true;
  const showArrowHead = isHighlighted || zoom >= EDGE_ARROW_ZOOM;
  const labelOffset = isLabelDragging ? draftLabelOffset : storedLabelOffset;
  const laneOffset = getEdgeLaneOffset(id);
  const edgeSpreadKey = `${id}|${data?.sourceHandleId ?? sourceHandleId ?? ""}|${data?.targetHandleId ?? targetHandleId ?? ""}|${data?.resource?.kind ?? ""}:${data?.resource?.id ?? ""}`;
  const arrowOffset = getEdgeArrowOffset(edgeSpreadKey);
  const pathSpreadOffset = getEdgePathSpreadOffset(edgeSpreadKey);
  const rawRoutedEdge =
    data?.bundle?.role === "primary"
      ? getBundledEdgePath({
          edgeId: id,
          sourceNodeId: source,
          sourceHandleIds: data.bundle.sourceHandleIds,
          sourcePosition: visualSource.side,
          fallbackSource: visualSource,
          targetNodeId: target,
          targetX: visualTarget.x,
          targetY: visualTarget.y,
          targetPosition: visualTarget.side,
        })
      : data?.bundle?.mode === "multi-target"
        ? getBundledMemberEdgePath({
            edgeId: id,
            sourceNodeId: source,
            sourceHandleId: data.sourceHandleId ?? sourceHandleId ?? undefined,
            sourcePosition: visualSource.side,
            fallbackSource: visualSource,
            targetNodeId: target,
            targetX: visualTarget.x,
            targetY: visualTarget.y,
            targetPosition: visualTarget.side,
            bundleSourceHandleIds: data.bundle.sourceHandleIds,
          })
        : getDirectEdgePath({
            laneOffset,
            sourceNodeId: source,
            sourceIsRecipeNode: !data?.sourceStorageEndpoint,
            sourceX: visualSource.x,
            sourceY: visualSource.y,
            sourcePosition: visualSource.side,
            targetNodeId: target,
            targetIsRecipeNode: !data?.targetStorageEndpoint,
            targetX: visualTarget.x,
            targetY: visualTarget.y,
            targetPosition: visualTarget.side,
          });
  const routedEdge = spreadRoutedEdge(rawRoutedEdge, pathSpreadOffset);
  const labelX = routedEdge.labelX + labelOffset.x;
  const labelY = routedEdge.labelY + labelOffset.y;

  const stopLabelDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!labelDragRef.current) {
        return;
      }

      event.currentTarget.releasePointerCapture(labelDragRef.current.pointerId);
      labelDragRef.current = undefined;
      setLabelDragging(false);
      const nextOffset =
        Math.abs(draftLabelOffset.x) < 1 && Math.abs(draftLabelOffset.y) < 1
          ? undefined
          : draftLabelOffset;
      updateEdge(id, { labelOffset: nextOffset });
    },
    [draftLabelOffset, id, updateEdge],
  );

  return (
    <>
      {!isHiddenBundleMember ? (
        <>
          <BaseEdge
            path={routedEdge.path}
            interactionWidth={0}
            style={{
              stroke: "#111827",
              strokeDasharray: isGlobalView && data?.isLimited ? "2 8" : style?.strokeDasharray,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeOpacity: isHighlighted ? 0.95 : isGlobalView ? 0.36 : 0.72,
              strokeWidth:
                (isHighlighted
                  ? 6
                  : data?.bundle?.role === "primary"
                    ? Math.max(Number(style?.strokeWidth ?? 2.6) + 0.6, 3.2)
                    : Number(style?.strokeWidth ?? 2.6)) + 2,
              pointerEvents: "none",
            }}
          />
          <BaseEdge
            path={routedEdge.path}
            interactionWidth={0}
            style={{
              ...style,
              stroke: edgeColor,
              strokeDasharray: isGlobalView && data?.isLimited ? "2 8" : style?.strokeDasharray,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeOpacity: isHighlighted
                ? 1
                : isGlobalView
                  ? data?.isLimited
                    ? 0.28
                    : 0.52
                  : style?.strokeOpacity,
              strokeWidth: isHighlighted
                ? 6
                : data?.bundle?.role === "primary"
                  ? Math.max(Number(style?.strokeWidth ?? 2.6) + 0.6, 3.2)
                  : style?.strokeWidth,
              filter: isHighlighted ? "drop-shadow(0 0 4px rgba(34,211,238,0.9))" : undefined,
            }}
          />
        </>
      ) : null}
      {!isHiddenBundleMember && showArrowHead ? (
        <polyline
          points={getArrowHeadPointsForRoute({
            points: routedEdge.points,
            fallbackTargetX: visualTarget.x,
            fallbackTargetY: visualTarget.y,
            fallbackTargetPosition: visualTarget.side,
            arrowOffset,
          })}
          stroke="#252525"
          strokeWidth={isHighlighted ? 4 : 3.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          style={{
            opacity: data?.isLimited ? 0.72 : 0.95,
            filter: isHighlighted ? "drop-shadow(0 0 4px rgba(34,211,238,0.9))" : undefined,
            pointerEvents: "none",
          }}
        />
      ) : null}
      {!isHiddenBundleMember && showArrowHead ? (
        <polyline
          points={getArrowHeadPointsForRoute({
            points: routedEdge.points,
            fallbackTargetX: visualTarget.x,
            fallbackTargetY: visualTarget.y,
            fallbackTargetPosition: visualTarget.side,
            arrowOffset,
          })}
          stroke={edgeColor}
          strokeWidth={isHighlighted ? 2.2 : 1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          style={{
            opacity: data?.isLimited ? 0.78 : 1,
            filter: isHighlighted ? "drop-shadow(0 0 4px rgba(34,211,238,0.9))" : undefined,
            pointerEvents: "none",
          }}
        />
      ) : null}
      {showLabel && data ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute flex cursor-grab items-center gap-1 border border-[#252525] bg-[#2b2d32] px-1 py-0.5 text-[10px] font-medium text-white shadow-[inset_1px_1px_0_rgba(255,255,255,0.18),inset_-1px_-1px_0_rgba(0,0,0,0.55)] active:cursor-grabbing"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              color: data.isLimited ? "#fecaca" : "#f8fafc",
              borderColor: edgeColor,
              opacity: isHighlighted ? 1 : isGlobalView ? 0.78 : 0.94,
              boxShadow: isHighlighted ? "0 0 0 2px rgba(34,211,238,0.9)" : undefined,
            }}
            title={`${data.resource.displayName ?? data.resource.id}: ${rate}. Drag along cable. Double click to reset label.`}
            onPointerDown={(event) => {
              event.stopPropagation();
              window.dispatchEvent(
                new CustomEvent(FLOW_EDGE_LABEL_SELECT_EVENT, {
                  detail: { edgeIds: data.bundle?.edgeIds ?? [id] },
                }),
              );
              event.currentTarget.setPointerCapture(event.pointerId);
              labelDragRef.current = {
                pointerId: event.pointerId,
                clientX: event.clientX,
                clientY: event.clientY,
                offset: labelOffset,
              };
              setLabelDragging(true);
              setDraftLabelOffset(labelOffset);
            }}
            onPointerMove={(event) => {
              const drag = labelDragRef.current;
              if (!drag) {
                return;
              }

              event.stopPropagation();
              const flowPoint = screenToFlowPoint(
                { x: event.clientX, y: event.clientY },
                event.currentTarget,
              );
              const cablePoint = flowPoint
                ? getClosestPointOnPolyline(flowPoint, routedEdge.points)
                : undefined;

              if (cablePoint) {
                setDraftLabelOffset({
                  x: cablePoint.x - routedEdge.labelX,
                  y: cablePoint.y - routedEdge.labelY,
                });
              } else {
                const scale = zoom > 0 ? zoom : 1;
                setDraftLabelOffset({
                  x: drag.offset.x + (event.clientX - drag.clientX) / scale,
                  y: drag.offset.y + (event.clientY - drag.clientY) / scale,
                });
              }
            }}
            onPointerUp={stopLabelDrag}
            onPointerCancel={stopLabelDrag}
            onDoubleClick={(event) => {
              event.stopPropagation();
              setDraftLabelOffset({ x: 0, y: 0 });
              updateEdge(id, { labelOffset: undefined });
            }}
          >
            <ResourceIcon
              resource={data.resource}
              size="sm"
              showAmount={false}
              bare
              className="!h-4 !w-4"
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

function getEdgeBundles(
  project: FactoryProject,
  edges: FactoryEdge[],
  edgeResults: Record<
    string,
    { demandPerSecond?: number; transferredPerSecond?: number; isLimited?: boolean }
  >,
) {
  const groups = new Map<string, FactoryEdge[]>();

  for (const edge of edges) {
    const sourceHandle = parseResourceHandleId(edge.sourceHandle);
    if (edge.sourceHandle && (!sourceHandle || sourceHandle.side !== "output")) {
      continue;
    }

    const key = [edge.source, edge.resourceKind, edge.resourceId].join("|");
    const group = groups.get(key);
    if (group) {
      group.push(edge);
    } else {
      groups.set(key, [edge]);
    }
  }

  const bundles = new Map<string, NonNullable<ResourceEdgeData["bundle"]>>();
  for (const group of groups.values()) {
    const explicitSourceHandleIds = [
      ...new Set(
        group
          .map((edge) => edge.sourceHandle)
          .filter((handleId): handleId is string => Boolean(handleId)),
      ),
    ];
    const inferredSourceHandleIds = group.some((edge) => edge.sourceHandle)
      ? []
      : inferRepeatedOutputHandleIds(project, group[0]);
    const sourceHandleIds =
      explicitSourceHandleIds.length > 1 ? explicitSourceHandleIds : inferredSourceHandleIds;
    if (sourceHandleIds.length < 2) {
      continue;
    }

    const primaryEdge = group[Math.floor(group.length / 2)];
    const targetKeys = new Set(
      group.map((edge) => `${edge.target}|${edge.targetHandle ?? ""}|${edge.resourceKind}`),
    );
    const mode = targetKeys.size === 1 ? "single-target" : "multi-target";
    const demand = group.reduce(
      (sum, edge) => sum + (edgeResults[edge.id]?.demandPerSecond ?? edge.ratePerSecond ?? 0),
      0,
    );
    const transferred = group.reduce(
      (sum, edge) =>
        sum +
        (edgeResults[edge.id]?.isLimited
          ? (edgeResults[edge.id]?.transferredPerSecond ?? 0)
          : (edgeResults[edge.id]?.demandPerSecond ?? edge.ratePerSecond ?? 0)),
      0,
    );
    const isLimited = group.some((edge) => edgeResults[edge.id]?.isLimited === true);
    const primarySourceHandleId = primaryEdge.sourceHandle ?? sourceHandleIds[0];
    const edgeIds = group.map((edge) => edge.id);
    if (!primarySourceHandleId) {
      continue;
    }

    for (const edge of group) {
      bundles.set(edge.id, {
        role: edge.id === primaryEdge.id ? "primary" : "member",
        mode,
        size: group.length,
        sourceHandleIds,
        primarySourceHandleId,
        edgeIds,
        demand: mode === "single-target" ? formatRate(demand) : undefined,
        transferred: mode === "single-target" && isLimited ? formatRate(transferred) : undefined,
        isLimited,
      });
    }
  }

  return bundles;
}

function inferRepeatedOutputHandleIds(project: FactoryProject, edge: FactoryEdge | undefined) {
  if (!edge) {
    return [];
  }

  return getRepeatedOutputHandleIds(project, edge.source, {
    kind: edge.resourceKind,
    id: edge.resourceId,
  });
}

function getRepeatedOutputHandleIds(
  project: FactoryProject,
  sourceNodeId: string,
  resource: Pick<ResourceAmount, "kind" | "id">,
) {
  const sourceStorage = (project.storages ?? []).find((storage) => storage.id === sourceNodeId);
  if (sourceStorage) {
    return [];
  }

  const sourceNode = project.nodes.find((node) => node.id === sourceNodeId);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  if (!sourceRecipe) {
    return [];
  }

  return sourceRecipe.outputs
    .map((output, outputIndex) =>
      output.kind === resource.kind && output.id === resource.id
        ? makeResourceHandleId("output", output, outputIndex)
        : undefined,
    )
    .filter((handleId): handleId is string => Boolean(handleId));
}

function getDirectEdgePath({
  laneOffset = 0,
  sourceNodeId,
  sourceIsRecipeNode,
  sourceX,
  sourceY,
  sourcePosition,
  targetNodeId,
  targetIsRecipeNode,
  targetX,
  targetY,
  targetPosition,
}: {
  laneOffset?: number;
  sourceNodeId?: string;
  sourceIsRecipeNode?: boolean;
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetNodeId?: string;
  targetIsRecipeNode?: boolean;
  targetX: number;
  targetY: number;
  targetPosition: Position;
}) {
  const topLanePoints =
    sourceIsRecipeNode && targetIsRecipeNode
      ? getTopLaneEdgePoints({
          sourceNodeId,
          sourceX,
          sourceY,
          targetNodeId,
          targetX,
          targetY,
        })
      : undefined;

  if (topLanePoints) {
    const labelPoint = getPointAtPolylineRatio(topLanePoints, 0.5) ?? {
      x: (sourceX + targetX) / 2,
      y: (sourceY + targetY) / 2,
    };

    return {
      path: pointsToSvgPath(topLanePoints),
      labelX: labelPoint.x,
      labelY: labelPoint.y,
      points: topLanePoints,
    };
  }

  const cleanStepPoints = getCleanDirectEdgePoints({
    laneOffset,
    sourceNodeId,
    sourceX,
    sourceY,
    sourcePosition,
    targetNodeId,
    targetX,
    targetY,
    targetPosition,
  });
  if (cleanStepPoints) {
    const labelPoint = getPointAtPolylineRatio(cleanStepPoints, 0.5) ?? {
      x: (sourceX + targetX) / 2,
      y: (sourceY + targetY) / 2,
    };

    return {
      path: pointsToSvgPath(cleanStepPoints),
      labelX: labelPoint.x,
      labelY: labelPoint.y,
      points: cleanStepPoints,
    };
  }

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const midX = labelX;
  const points = compactPolylinePoints([
    { x: sourceX, y: sourceY },
    { x: midX, y: sourceY },
    { x: midX, y: targetY },
    { x: targetX, y: targetY },
  ]);

  return {
    path,
    labelX,
    labelY,
    points,
  };
}

function getCleanDirectEdgePoints({
  laneOffset = 0,
  sourceNodeId,
  sourceX,
  sourceY,
  sourcePosition,
  targetNodeId,
  targetX,
  targetY,
  targetPosition,
}: {
  laneOffset?: number;
  sourceNodeId?: string;
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetNodeId?: string;
  targetX: number;
  targetY: number;
  targetPosition: Position;
}) {
  const sourceBounds = sourceNodeId ? getMeasuredNodeBounds(sourceNodeId) : undefined;
  const targetBounds = targetNodeId ? getMeasuredNodeBounds(targetNodeId) : undefined;

  if (!sourceBounds && !targetBounds) {
    return undefined;
  }

  const sourceExit = getNodeClearancePoint({
    point: { x: sourceX, y: sourceY },
    bounds: sourceBounds,
    position: sourcePosition,
    role: "source",
  });
  const targetExit = getNodeClearancePoint({
    point: { x: targetX, y: targetY },
    bounds: targetBounds,
    position: targetPosition,
    role: "target",
  });

  if (!sourceExit && !targetExit) {
    return undefined;
  }

  const start = sourceExit ?? { x: sourceX, y: sourceY };
  const end = targetExit ?? { x: targetX, y: targetY };
  const sourceSide = String(sourcePosition);
  const targetSide = String(targetPosition);
  if (sourceNodeId && sourceNodeId === targetNodeId && sourceBounds) {
    return compactPolylinePoints([
      { x: sourceX, y: sourceY },
      start,
      ...getSelfNodeEdgePoints(start, end, sourceSide, targetSide, sourceBounds, laneOffset),
      end,
      { x: targetX, y: targetY },
    ]);
  }

  const points =
    isHorizontalSide(sourceSide) || isHorizontalSide(targetSide)
      ? getHorizontalLaneDirectPoints(
          start,
          end,
          sourceSide,
          targetSide,
          sourceBounds,
          targetBounds,
          laneOffset,
        )
      : getVerticalLaneDirectPoints(
          start,
          end,
          sourceSide,
          targetSide,
          sourceBounds,
          targetBounds,
          laneOffset,
        );

  return compactPolylinePoints([
    { x: sourceX, y: sourceY },
    start,
    ...points,
    end,
    { x: targetX, y: targetY },
  ]);
}

function getNodeClearancePoint({
  point,
  bounds,
  position,
  role,
}: {
  point: { x: number; y: number };
  bounds?: { left: number; right: number; top: number; bottom: number };
  position: Position;
  role: "source" | "target";
}) {
  if (!bounds) {
    return undefined;
  }

  const side = String(position);
  switch (side) {
    case "right":
      return {
        x: Math.max(point.x, bounds.right) + DIRECT_EDGE_NODE_CLEARANCE,
        y: point.y,
      };
    case "left":
      return {
        x: Math.min(point.x, bounds.left) - DIRECT_EDGE_NODE_CLEARANCE,
        y: point.y,
      };
    case "bottom":
      return {
        x: point.x,
        y: Math.max(point.y, bounds.bottom) + DIRECT_EDGE_NODE_CLEARANCE,
      };
    case "top":
      return {
        x: point.x,
        y: Math.min(point.y, bounds.top) - DIRECT_EDGE_NODE_CLEARANCE,
      };
    default:
      return role === "source"
        ? {
            x: point.x + DIRECT_EDGE_NODE_CLEARANCE,
            y: point.y,
          }
        : {
            x: point.x - DIRECT_EDGE_NODE_CLEARANCE,
            y: point.y,
          };
  }
}

function getHorizontalLaneDirectPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  sourceSide: string,
  targetSide: string,
  sourceBounds?: { left: number; right: number; top: number; bottom: number },
  targetBounds?: { left: number; right: number; top: number; bottom: number },
  laneOffset = 0,
) {
  const goesRight = end.x >= start.x;
  const sourceWantsRight = sourceSide === "right";
  const targetWantsLeft = targetSide === "left";
  const targetWantsRight = targetSide === "right";
  const hasVerticalGap =
    sourceBounds && targetBounds ? !boundsOverlapVertically(sourceBounds, targetBounds) : false;

  if (hasVerticalGap && sourceBounds && targetBounds && (targetWantsLeft || targetWantsRight)) {
    const sourceLaneY =
      end.y >= start.y
        ? sourceBounds.bottom + DIRECT_EDGE_NODE_CLEARANCE + laneOffset
        : sourceBounds.top - DIRECT_EDGE_NODE_CLEARANCE - laneOffset;
    const targetLaneX = targetWantsLeft
      ? Math.min(end.x, targetBounds.left - DIRECT_EDGE_NODE_CLEARANCE - laneOffset)
      : Math.max(end.x, targetBounds.right + DIRECT_EDGE_NODE_CLEARANCE + laneOffset);
    return [
      { x: start.x, y: sourceLaneY },
      { x: targetLaneX, y: sourceLaneY },
      { x: targetLaneX, y: end.y },
    ];
  }

  const routeOutsideRight =
    (sourceWantsRight && !targetWantsLeft) || (!sourceSide && goesRight) || sourceSide === "right";
  const routeX = routeOutsideRight
    ? Math.max(start.x, end.x, sourceBounds?.right ?? -Infinity, targetBounds?.right ?? -Infinity) +
      DIRECT_EDGE_NODE_CLEARANCE +
      laneOffset
    : Math.min(start.x, end.x, sourceBounds?.left ?? Infinity, targetBounds?.left ?? Infinity) -
      DIRECT_EDGE_NODE_CLEARANCE -
      laneOffset;

  if (
    sourceWantsRight &&
    targetWantsLeft &&
    Math.abs(end.x - start.x) > DIRECT_EDGE_NODE_CLEARANCE * 3
  ) {
    const midX = (start.x + end.x) / 2;
    return [
      { x: midX, y: start.y },
      { x: midX, y: end.y },
    ];
  }

  return [
    { x: routeX, y: start.y },
    { x: routeX, y: end.y },
  ];
}

function getVerticalLaneDirectPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  sourceSide: string,
  targetSide: string,
  sourceBounds?: { left: number; right: number; top: number; bottom: number },
  targetBounds?: { left: number; right: number; top: number; bottom: number },
  laneOffset = 0,
) {
  const routeBelow = sourceSide === "bottom" || (targetSide !== "bottom" && end.y >= start.y);
  const routeY = routeBelow
    ? Math.max(
        start.y,
        end.y,
        sourceBounds?.bottom ?? -Infinity,
        targetBounds?.bottom ?? -Infinity,
      ) +
      DIRECT_EDGE_NODE_CLEARANCE +
      laneOffset
    : Math.min(start.y, end.y, sourceBounds?.top ?? Infinity, targetBounds?.top ?? Infinity) -
      DIRECT_EDGE_NODE_CLEARANCE -
      laneOffset;

  return [
    { x: start.x, y: routeY },
    { x: end.x, y: routeY },
  ];
}

function getSelfNodeEdgePoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  sourceSide: string,
  targetSide: string,
  bounds: { left: number; right: number; top: number; bottom: number },
  laneOffset = 0,
) {
  if (isHorizontalSide(sourceSide) || isHorizontalSide(targetSide)) {
    const useLeftLane =
      targetSide === "left" ||
      (sourceSide !== "right" && Math.abs(end.x - bounds.left) < Math.abs(end.x - bounds.right));
    const routeX = useLeftLane
      ? bounds.left - DIRECT_EDGE_NODE_CLEARANCE - laneOffset
      : bounds.right + DIRECT_EDGE_NODE_CLEARANCE + laneOffset;
    const routeAbove = end.y < start.y;
    const routeY = routeAbove
      ? bounds.top - DIRECT_EDGE_NODE_CLEARANCE - laneOffset
      : bounds.bottom + DIRECT_EDGE_NODE_CLEARANCE + laneOffset;

    return [
      { x: start.x, y: routeY },
      { x: routeX, y: routeY },
      { x: routeX, y: end.y },
    ];
  }

  const routeBelow = targetSide === "bottom" || end.y >= start.y;
  const routeY = routeBelow
    ? bounds.bottom + DIRECT_EDGE_NODE_CLEARANCE + laneOffset
    : bounds.top - DIRECT_EDGE_NODE_CLEARANCE - laneOffset;

  return [
    { x: start.x, y: routeY },
    { x: end.x, y: routeY },
  ];
}

function isHorizontalSide(side: string) {
  return side === "left" || side === "right";
}

function getEdgeLaneOffset(edgeId: string) {
  return getEdgeHash(edgeId, EDGE_LANE_BUCKETS) * EDGE_LANE_SPACING;
}

function getEdgeArrowOffset(edgeKey: string) {
  return getEdgeHash(edgeKey, EDGE_ARROW_BUCKETS) * EDGE_ARROW_SPACING;
}

function getEdgePathSpreadOffset(edgeKey: string) {
  return (
    (getEdgeHash(edgeKey, EDGE_PATH_SPREAD_BUCKETS) - (EDGE_PATH_SPREAD_BUCKETS - 1) / 2) *
    EDGE_PATH_SPREAD_SPACING
  );
}

function getEdgeHash(edgeId: string, buckets: number) {
  let hash = 0;
  for (let index = 0; index < edgeId.length; index += 1) {
    hash = (hash * 31 + edgeId.charCodeAt(index)) | 0;
  }

  return Math.abs(hash % buckets);
}

function spreadRoutedEdge<
  T extends {
    path: string;
    labelX: number;
    labelY: number;
    points: Array<{ x: number; y: number }>;
  },
>(routedEdge: T, offset: number): T {
  if (Math.abs(offset) < 0.5 || routedEdge.points.length < 3) {
    return routedEdge;
  }

  const first = routedEdge.points[0];
  const last = routedEdge.points[routedEdge.points.length - 1];
  const spreadVector =
    Math.abs(last.y - first.y) > Math.abs(last.x - first.x)
      ? { x: offset, y: 0 }
      : { x: 0, y: offset };
  const points = routedEdge.points.map((point, index) =>
    index === 0 || index === routedEdge.points.length - 1
      ? point
      : { x: point.x + spreadVector.x, y: point.y + spreadVector.y },
  );

  return {
    ...routedEdge,
    path: pointsToSvgPath(points),
    labelX: routedEdge.labelX + spreadVector.x,
    labelY: routedEdge.labelY + spreadVector.y,
    points,
  };
}

function boundsOverlapVertically(
  left: { top: number; bottom: number },
  right: { top: number; bottom: number },
) {
  return left.bottom >= right.top && right.bottom >= left.top;
}

function getBundledEdgePath({
  edgeId,
  sourceNodeId,
  sourceHandleIds,
  sourcePosition,
  fallbackSource,
  targetNodeId,
  targetX,
  targetY,
  targetPosition,
}: {
  edgeId: string;
  sourceNodeId: string;
  sourceHandleIds: string[];
  sourcePosition: Position;
  fallbackSource: { x: number; y: number };
  targetNodeId?: string;
  targetX: number;
  targetY: number;
  targetPosition: Position;
}) {
  const sourcePoints = sourceHandleIds
    .map((handleId) =>
      getMeasuredSlotEndpoint({
        nodeId: sourceNodeId,
        handleId,
        edgeSide: String(sourcePosition),
      }),
    )
    .filter((point): point is { x: number; y: number } => Boolean(point))
    .sort((left, right) => left.y - right.y || left.x - right.x);

  if (sourcePoints.length < 2) {
    return getDirectEdgePath({
      sourceNodeId,
      sourceX: fallbackSource.x,
      sourceY: fallbackSource.y,
      sourcePosition,
      targetNodeId,
      targetX,
      targetY,
      targetPosition,
      laneOffset: getEdgeLaneOffset(edgeId),
    });
  }

  const isLeft = String(sourcePosition) === "left";
  const sourceBounds = getMeasuredNodeBounds(sourceNodeId);
  const busX = isLeft
    ? (sourceBounds?.left ?? Math.min(...sourcePoints.map((point) => point.x))) -
      EDGE_BUNDLE_CLEARANCE
    : (sourceBounds?.right ?? Math.max(...sourcePoints.map((point) => point.x))) +
      EDGE_BUNDLE_CLEARANCE;
  const minY = Math.min(...sourcePoints.map((point) => point.y));
  const maxY = Math.max(...sourcePoints.map((point) => point.y));
  const trunkY = sourcePoints[Math.floor(sourcePoints.length / 2)].y;
  const trunkPoints =
    getCleanDirectEdgePoints({
      laneOffset: getEdgeLaneOffset(edgeId),
      sourceX: busX,
      sourceY: trunkY,
      sourcePosition,
      targetNodeId,
      targetX,
      targetY,
      targetPosition,
    }) ??
    compactPolylinePoints([
      { x: busX, y: trunkY },
      { x: (busX + targetX) / 2, y: trunkY },
      { x: (busX + targetX) / 2, y: targetY },
      { x: targetX, y: targetY },
    ]);
  const path = [
    ...sourcePoints.map((point) => `M ${point.x},${point.y} L ${busX},${point.y}`),
    `M ${busX},${minY} L ${busX},${maxY}`,
    pointsToSvgPath(trunkPoints),
  ].join(" ");
  const labelPoint = getPointAtPolylineRatio(trunkPoints, 0.55) ?? {
    x: (busX + targetX) / 2,
    y: (trunkY + targetY) / 2,
  };

  return {
    path,
    labelX: labelPoint.x,
    labelY: labelPoint.y,
    points: trunkPoints,
  };
}

function getBundledMemberEdgePath({
  edgeId,
  sourceNodeId,
  sourceHandleId,
  sourcePosition,
  fallbackSource,
  targetNodeId,
  targetX,
  targetY,
  targetPosition,
  bundleSourceHandleIds,
}: {
  edgeId: string;
  sourceNodeId: string;
  sourceHandleId?: string;
  sourcePosition: Position;
  fallbackSource: { x: number; y: number };
  targetNodeId?: string;
  targetX: number;
  targetY: number;
  targetPosition: Position;
  bundleSourceHandleIds: string[];
}) {
  const allSourcePoints = bundleSourceHandleIds
    .map((handleId) =>
      getMeasuredSlotEndpoint({
        nodeId: sourceNodeId,
        handleId,
        edgeSide: String(sourcePosition),
      }),
    )
    .filter((point): point is { x: number; y: number } => Boolean(point));
  const ownSourcePoint = sourceHandleId
    ? getMeasuredSlotEndpoint({
        nodeId: sourceNodeId,
        handleId: sourceHandleId,
        edgeSide: String(sourcePosition),
      })
    : undefined;

  if (allSourcePoints.length < 2 || !ownSourcePoint) {
    return getDirectEdgePath({
      sourceNodeId,
      sourceX: fallbackSource.x,
      sourceY: fallbackSource.y,
      sourcePosition,
      targetNodeId,
      targetX,
      targetY,
      targetPosition,
      laneOffset: getEdgeLaneOffset(edgeId),
    });
  }

  const isLeft = String(sourcePosition) === "left";
  const sourceBounds = getMeasuredNodeBounds(sourceNodeId);
  const busX = isLeft
    ? (sourceBounds?.left ?? Math.min(...allSourcePoints.map((point) => point.x))) -
      EDGE_BUNDLE_CLEARANCE
    : (sourceBounds?.right ?? Math.max(...allSourcePoints.map((point) => point.x))) +
      EDGE_BUNDLE_CLEARANCE;
  const points =
    getCleanDirectEdgePoints({
      laneOffset: getEdgeLaneOffset(edgeId),
      sourceX: busX,
      sourceY: ownSourcePoint.y,
      sourcePosition,
      targetNodeId,
      targetX,
      targetY,
      targetPosition,
    }) ??
    compactPolylinePoints([
      { x: busX, y: ownSourcePoint.y },
      { x: (busX + targetX) / 2, y: ownSourcePoint.y },
      { x: (busX + targetX) / 2, y: targetY },
      { x: targetX, y: targetY },
    ]);
  const labelPoint = getPointAtPolylineRatio(points, 0.55) ?? {
    x: (busX + targetX) / 2,
    y: (ownSourcePoint.y + targetY) / 2,
  };
  const path = pointsToSvgPath(points);
  const [fallbackPath, fallbackLabelX, fallbackLabelY] = getSmoothStepPath({
    sourceX: busX,
    sourceY: ownSourcePoint.y,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return {
    path: path || fallbackPath,
    labelX: path ? labelPoint.x : fallbackLabelX,
    labelY: path ? labelPoint.y : fallbackLabelY,
    points,
  };
}

function getTopLaneEdgePoints({
  sourceNodeId,
  sourceX,
  sourceY,
  targetNodeId,
  targetX,
  targetY,
}: {
  sourceNodeId?: string;
  sourceX: number;
  sourceY: number;
  targetNodeId?: string;
  targetX: number;
  targetY: number;
}) {
  if (!sourceNodeId || !targetNodeId) {
    return undefined;
  }

  const sourceBounds = getMeasuredNodeBounds(sourceNodeId);
  const targetBounds = getMeasuredNodeBounds(targetNodeId);
  if (!sourceBounds || !targetBounds) {
    return undefined;
  }

  const goesRight = targetX >= sourceX;
  const horizontalGap = goesRight
    ? targetBounds.left - sourceBounds.right
    : sourceBounds.left - targetBounds.right;
  const sourcePointInsideNode = sourceY >= sourceBounds.top && sourceY <= sourceBounds.bottom;
  const targetPointInsideNode = targetY >= targetBounds.top && targetY <= targetBounds.bottom;
  const roughlySameRow = Math.abs(targetY - sourceY) <= 90;

  if (
    horizontalGap < 24 ||
    horizontalGap > 900 ||
    !sourcePointInsideNode ||
    !targetPointInsideNode
  ) {
    return undefined;
  }

  if (!roughlySameRow) {
    return undefined;
  }

  const laneY = Math.min(sourceBounds.top, targetBounds.top) - 10;
  const sourceExitX = sourceX + (goesRight ? 20 : -20);
  const targetApproachX = targetX + (goesRight ? -20 : 20);

  return compactPolylinePoints([
    { x: sourceX, y: sourceY },
    { x: sourceExitX, y: sourceY },
    { x: sourceExitX, y: laneY },
    { x: targetApproachX, y: laneY },
    { x: targetApproachX, y: targetY },
    { x: targetX, y: targetY },
  ]);
}

function compactPolylinePoints(points: Array<{ x: number; y: number } | undefined>) {
  const compacted: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    if (!point) {
      continue;
    }

    const previous = compacted[compacted.length - 1];
    if (previous && Math.abs(previous.x - point.x) < 0.5 && Math.abs(previous.y - point.y) < 0.5) {
      continue;
    }

    compacted.push(point);
  }

  return compacted;
}

function pointsToSvgPath(points: Array<{ x: number; y: number }>) {
  const [first, ...rest] = points;
  if (!first) {
    return "";
  }

  return [`M ${first.x},${first.y}`, ...rest.map((point) => `L ${point.x},${point.y}`)].join(" ");
}

function getPointAtPolylineRatio(points: Array<{ x: number; y: number }>, ratio: number) {
  const segments = getPolylineSegments(points);
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (totalLength <= 0) {
    return points[0];
  }

  let remaining = totalLength * clamp(ratio, 0, 1);
  for (const segment of segments) {
    if (remaining <= segment.length) {
      const t = segment.length <= 0 ? 0 : remaining / segment.length;
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * t,
        y: segment.start.y + (segment.end.y - segment.start.y) * t,
      };
    }

    remaining -= segment.length;
  }

  return points[points.length - 1];
}

function getClosestPointOnPolyline(
  point: { x: number; y: number },
  points: Array<{ x: number; y: number }>,
) {
  return getPolylineSegments(points)
    .map((segment) => getClosestPointOnSegment(point, segment.start, segment.end))
    .sort((left, right) => left.distanceSquared - right.distanceSquared)[0]?.point;
}

function getPolylineSegments(points: Array<{ x: number; y: number }>) {
  const segments: Array<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    length: number;
  }> = [];

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > 0.5) {
      segments.push({ start, end, length });
    }
  }

  return segments;
}

function getClosestPointOnSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared <= 0
      ? 0
      : clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  const closest = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  };
  const distanceX = point.x - closest.x;
  const distanceY = point.y - closest.y;

  return {
    point: closest,
    distanceSquared: distanceX * distanceX + distanceY * distanceY,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getSlotEdgeEndpoint({
  nodeId,
  handleId,
  position,
  fallbackX,
  fallbackY,
  isRecipeSlotEndpoint,
  isStorageSlotEndpoint,
  counterpartX,
  counterpartY,
}: {
  nodeId: string;
  handleId?: string | null;
  position: unknown;
  fallbackX: number;
  fallbackY: number;
  isRecipeSlotEndpoint?: boolean;
  isStorageSlotEndpoint?: boolean;
  counterpartX?: number;
  counterpartY?: number;
}) {
  if (!isRecipeSlotEndpoint && !isStorageSlotEndpoint) {
    return { x: fallbackX, y: fallbackY, side: positionToEdgeSide(position) };
  }

  const edgeSide =
    isStorageSlotEndpoint && counterpartX !== undefined && counterpartY !== undefined
      ? getStorageEdgeSideTowardPoint({
          nodeId,
          handleId,
          fallbackX,
          fallbackY,
          counterpartX,
          counterpartY,
          fallbackSide: positionToEdgeSide(position),
        })
      : positionToEdgeSide(position);

  const measuredEndpoint = getMeasuredSlotEndpoint({
    nodeId,
    handleId,
    edgeSide,
  });
  if (measuredEndpoint) {
    return { ...measuredEndpoint, side: edgeSide };
  }

  const offset = isStorageSlotEndpoint ? STORAGE_SLOT_EDGE_OFFSET : RECIPE_SLOT_EDGE_OFFSET;

  switch (edgeSide) {
    case "right":
      return {
        x: fallbackX + (isStorageSlotEndpoint ? -offset : offset),
        y: fallbackY,
        side: edgeSide,
      };
    case "left":
      return {
        x: fallbackX + (isStorageSlotEndpoint ? offset : -offset),
        y: fallbackY,
        side: edgeSide,
      };
    case "top":
      return { x: fallbackX, y: fallbackY - offset, side: edgeSide };
    case "bottom":
      return { x: fallbackX, y: fallbackY + offset, side: edgeSide };
    default:
      return { x: fallbackX, y: fallbackY, side: edgeSide };
  }
}

function positionToEdgeSide(position: unknown): Position {
  switch (String(position)) {
    case "right":
      return Position.Right;
    case "left":
      return Position.Left;
    case "top":
      return Position.Top;
    case "bottom":
      return Position.Bottom;
    default:
      return Position.Right;
  }
}

function getStorageEdgeSideTowardPoint({
  nodeId,
  handleId,
  fallbackX,
  fallbackY,
  counterpartX,
  counterpartY,
  fallbackSide,
}: {
  nodeId: string;
  handleId?: string | null;
  fallbackX: number;
  fallbackY: number;
  counterpartX: number;
  counterpartY: number;
  fallbackSide: Position;
}) {
  const center = getMeasuredSlotCenter({ nodeId, handleId }) ?? { x: fallbackX, y: fallbackY };
  const distanceX = counterpartX - center.x;
  const distanceY = counterpartY - center.y;

  if (Math.abs(distanceY) > Math.abs(distanceX) * 1.15) {
    return distanceY >= 0 ? Position.Bottom : Position.Top;
  }

  if (Math.abs(distanceX) > 1) {
    return distanceX >= 0 ? Position.Right : Position.Left;
  }

  return fallbackSide;
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
  const screenPoint = getSlotRectEdgePoint(slotRect, edgeSide);

  return screenToFlowPoint(screenPoint, nodeElement);
}

function getMeasuredSlotCenter({ nodeId, handleId }: { nodeId: string; handleId?: string | null }) {
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
  return screenToFlowPoint(
    { x: slotRect.left + slotRect.width / 2, y: slotRect.top + slotRect.height / 2 },
    nodeElement,
  );
}

function getSlotRectEdgePoint(rect: DOMRect, edgeSide: string) {
  switch (edgeSide) {
    case "right":
      return { x: rect.right, y: rect.top + rect.height / 2 };
    case "top":
      return { x: rect.left + rect.width / 2, y: rect.top };
    case "bottom":
      return { x: rect.left + rect.width / 2, y: rect.bottom };
    case "left":
    default:
      return { x: rect.left, y: rect.top + rect.height / 2 };
  }
}

function getMeasuredNodeBounds(nodeId: string) {
  if (typeof document === "undefined") {
    return undefined;
  }

  const nodeElement = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${cssEscape(nodeId)}"]`,
  );
  if (!nodeElement) {
    return undefined;
  }

  const rect = nodeElement.getBoundingClientRect();
  const topLeft = screenToFlowPoint({ x: rect.left, y: rect.top }, nodeElement);
  const bottomRight = screenToFlowPoint({ x: rect.right, y: rect.bottom }, nodeElement);
  if (!topLeft || !bottomRight) {
    return undefined;
  }

  return {
    left: Math.min(topLeft.x, bottomRight.x),
    right: Math.max(topLeft.x, bottomRight.x),
    top: Math.min(topLeft.y, bottomRight.y),
    bottom: Math.max(topLeft.y, bottomRight.y),
  };
}

function screenToFlowPoint(point: { x: number; y: number }, element: HTMLElement) {
  const root = element.closest<HTMLElement>(".react-flow");
  const viewport =
    element.closest<HTMLElement>(".react-flow__viewport") ??
    root?.querySelector<HTMLElement>(".react-flow__viewport");
  const renderer =
    element.closest<HTMLElement>(".react-flow__renderer") ??
    root?.querySelector<HTMLElement>(".react-flow__renderer");
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
  project: FactoryProject,
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

    return !isCompatibleDraggedResourceTarget(project, draggedResource, resourceHandle);
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
  project: FactoryProject,
  draggedResource: DraggedResourceConnection,
  targetHandle: ResolvedResourceHandle,
) {
  const targetResource = getResourceForHandle(project, targetHandle.nodeId, targetHandle.handleId);
  const dragged = {
    kind: draggedResource.kind,
    id: draggedResource.id,
    alternatives: draggedResource.alternatives,
  };

  if (!targetResource) {
    return false;
  }

  return (
    draggedResource.nodeId !== targetHandle.nodeId &&
    draggedResource.side !== targetHandle.side &&
    draggedResource.kind === targetHandle.kind &&
    (targetHandle.side === "input"
      ? resourceMatchesInput(dragged, targetResource)
      : resourceMatchesInput(targetResource, dragged))
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
      resourceId &&
      nodeId !== draggedResource.nodeId &&
      (kind === "item" || kind === "fluid") &&
      kind === draggedResource.kind &&
      (draggedResource.side === "input"
        ? resourceMatchesInput({ kind, id: resourceId }, draggedResource)
        : resourceId === draggedResource.id)
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
  const length = 8;
  const width = 5;

  switch (String(targetPosition)) {
    case "right":
      return `${targetX + length},${targetY - width} ${targetX},${targetY} ${targetX + length},${targetY + width}`;
    case "top":
      return `${targetX - width},${targetY - length} ${targetX},${targetY} ${targetX + width},${targetY - length}`;
    case "bottom":
      return `${targetX - width},${targetY + length} ${targetX},${targetY} ${targetX + width},${targetY + length}`;
    case "left":
    default:
      return `${targetX - length},${targetY - width} ${targetX},${targetY} ${targetX - length},${targetY + width}`;
  }
}

function getArrowHeadPointsForRoute({
  points,
  fallbackTargetX,
  fallbackTargetY,
  fallbackTargetPosition,
  arrowOffset,
}: {
  points: Array<{ x: number; y: number }>;
  fallbackTargetX: number;
  fallbackTargetY: number;
  fallbackTargetPosition: unknown;
  arrowOffset: number;
}) {
  const routeTarget = points[points.length - 1];
  const routePrevious = points[points.length - 2];
  if (!routeTarget || !routePrevious) {
    return getArrowHeadPoints(fallbackTargetX, fallbackTargetY, fallbackTargetPosition);
  }

  const distanceX = routeTarget.x - routePrevious.x;
  const distanceY = routeTarget.y - routePrevious.y;
  const isVertical = Math.abs(distanceY) > Math.abs(distanceX);
  const length = Math.hypot(distanceX, distanceY);
  const retreatX = length > 0 ? (distanceX / length) * arrowOffset : 0;
  const retreatY = length > 0 ? (distanceY / length) * arrowOffset : 0;
  const target = {
    x: routeTarget.x - retreatX,
    y: routeTarget.y - retreatY,
  };
  const targetPosition = isVertical
    ? distanceY >= 0
      ? Position.Top
      : Position.Bottom
    : distanceX >= 0
      ? Position.Left
      : Position.Right;

  return getArrowHeadPoints(target.x, target.y, targetPosition);
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
    alternatives: resource.alternatives,
  };
}

function getResourceForHandle(
  project: FactoryProject,
  nodeId: string,
  handleId: string,
): ResourceAmount | undefined {
  const handle = parseResourceHandleId(handleId);
  if (!handle) {
    return undefined;
  }

  const storage = (project.storages ?? []).find((entry) => entry.id === nodeId);
  if (storage) {
    return {
      kind: storage.kind,
      id: storage.resourceId,
      amount: 1,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor ?? storage.iconAtlas?.dominantColor,
    };
  }

  const node = project.nodes.find((entry) => entry.id === nodeId);
  const recipe = project.recipes.find((entry) => entry.id === node?.recipeId);
  const resources = handle.side === "input" ? recipe?.inputs : recipe?.outputs;

  return resources?.find((entry) => entry.kind === handle.kind && entry.id === handle.resourceId);
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

function getExportImageSize(graphSize: number) {
  if (!Number.isFinite(graphSize) || graphSize <= 0) {
    return EXPORT_IMAGE_PADDING * 2;
  }

  return Math.ceil(graphSize + EXPORT_IMAGE_PADDING * 2);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function dispatchImageExportComplete(requestId: string) {
  window.dispatchEvent(
    new CustomEvent(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, {
      detail: { requestId },
    }),
  );
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

function recipeContainsResourceKey(recipe: Recipe | undefined, resourceKey: string) {
  if (!recipe) {
    return false;
  }

  return [...recipe.inputs, ...recipe.outputs].some(
    (resource) =>
      makeResourceKey(resource.kind, resource.id) === resourceKey ||
      resource.alternatives?.some(
        (alternative) => makeResourceKey(alternative.kind, alternative.id) === resourceKey,
      ),
  );
}

function exportNodeFilter(domNode: HTMLElement) {
  const element = domNode instanceof Element ? domNode : undefined;

  return !(
    element?.classList.contains("react-flow__edgeupdater") ||
    element?.classList.contains("react-flow__selection") ||
    element?.classList.contains("react-flow__nodesselection") ||
    element?.classList.contains("react-flow__handle")
  );
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
