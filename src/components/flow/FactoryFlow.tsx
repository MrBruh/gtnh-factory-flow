"use client";

import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import { formatRate } from "@/lib/model";
import { useFactoryStore } from "@/store/factory-store";
import { RecipeNode, type RecipeFlowNode } from "./RecipeNode";
import { parseResourceHandleId } from "./resource-handles";

const nodeTypes = {
  recipeNode: RecipeNode,
} satisfies NodeTypes;

export function FactoryFlow() {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const selectNode = useFactoryStore((state) => state.selectNode);
  const setNodePosition = useFactoryStore((state) => state.setNodePosition);
  const connectNodes = useFactoryStore((state) => state.connectNodes);
  const deleteEdge = useFactoryStore((state) => state.deleteEdge);
  const pendingResourceConnection = useFactoryStore((state) => state.pendingResourceConnection);
  const cancelResourceConnection = useFactoryStore((state) => state.cancelResourceConnection);

  const nodes = useMemo<RecipeFlowNode[]>(
    () =>
      project.nodes.map((node) => {
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
        };
      }),
    [project.nodes, project.recipes, result.nodes],
  );

  const edges = useMemo<Edge[]>(
    () =>
      project.edges.map((edge) => {
        const edgeResult = result.edges[edge.id];
        const unit = edge.resourceKind === "fluid" ? "L/s" : "/s";
        const demand = edgeResult?.demandPerSecond ?? edge.ratePerSecond ?? 0;
        const transferred = edgeResult?.transferredPerSecond ?? demand;
        const edgeColor = edgeResult?.isLimited
          ? "#dc2626"
          : edge.resourceKind === "fluid"
            ? "#0284c7"
            : "#0f766e";
        const prefix = edge.resourceKind === "fluid" ? "F" : "I";
        const label =
          edgeResult?.isLimited === true
            ? `${prefix} ${edge.label ?? edge.resourceId} ${formatRate(transferred)}/${formatRate(demand)}${unit}`
            : `${prefix} ${edge.label ?? edge.resourceId} ${formatRate(demand)}${unit}`;

        return {
          id: edge.id,
          zIndex: 20,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          type: "smoothstep",
          label,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: edgeColor,
          },
          style: {
            stroke: edgeColor,
            strokeDasharray: edgeResult?.isLimited ? "7 4" : undefined,
            strokeWidth: edgeResult?.isLimited ? 3 : 2,
          },
          labelBgPadding: [6, 3],
          labelBgBorderRadius: 4,
          labelStyle: {
            fill: edgeResult?.isLimited ? "#991b1b" : "#262626",
            fontSize: 12,
            fontWeight: 700,
          },
        };
      }),
    [project.edges, result.edges],
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
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onConnect={handleConnect}
        onNodeClick={(_, node) => selectNode(node.id)}
        onPaneClick={() => {
          selectNode(undefined);
          cancelResourceConnection();
        }}
        onNodeDragStop={(_, node) => setNodePosition(node.id, node.position)}
        onEdgesDelete={(deletedEdges) => deletedEdges.forEach((edge) => deleteEdge(edge.id))}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.15}
        maxZoom={1.8}
      >
        <Background gap={24} color="#d4d4d4" />
        <Controls position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(node) => {
            const status = result.nodes[node.id]?.status;
            if (status === "balanced") return "#10b981";
            if (status === "bottleneck" || status === "missing-recipe") return "#ef4444";
            if (status === "disabled") return "#a3a3a3";
            return "#f59e0b";
          }}
        />
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
