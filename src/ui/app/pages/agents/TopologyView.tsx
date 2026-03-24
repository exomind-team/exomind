import { Crosshair } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Edge as FlowEdge,
  type ReactFlowInstance,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { SIGNAL_NODE_TYPES, type SignalFlowNodeType } from './SignalFlowNode';
import { PHASE_LABELS } from './AgentDetailPage';
import type { SignalGraph } from '../agents-signal-topology';
import type {
  TopologyLayoutMode,
  TopologyNodePosition,
  TopologyViewport,
} from '../topology-layout';

export interface TopologyViewProps {
  graph: SignalGraph;
  layoutMode: TopologyLayoutMode;
  manualViewport?: TopologyViewport;
  onLayoutModeChange: (mode: TopologyLayoutMode) => void;
  onCommitNodePosition: (
    nodeId: string,
    position: TopologyNodePosition,
    viewport?: TopologyViewport,
  ) => void;
  onCommitViewport: (viewport: TopologyViewport) => void;
  onResetCurrentLayout: () => void;
  onClearSavedLayouts: () => void;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
}

export function TopologyView({
  graph,
  layoutMode,
  manualViewport,
  onLayoutModeChange,
  onCommitNodePosition,
  onCommitViewport,
  onResetCurrentLayout,
  onClearSavedLayouts,
  onSelectNode,
  onClearSelection,
}: TopologyViewProps) {
  const isDarkMode = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const activeEdgeColor = isDarkMode ? '#FB923C' : '#C75B3A';
  const inactiveEdgeColor = isDarkMode ? '#57534E' : '#A8A29E';
  const edgeLabelColor = isDarkMode ? '#D6D3D1' : '#78716C';
  const edgeLabelBgColor = isDarkMode ? '#1C1917' : '#FAF7F5';
  const backgroundDotColor = isDarkMode ? '#44403C' : '#E7E5E4';
  const flowInstanceRef = useRef<ReactFlowInstance<SignalFlowNodeType> | null>(null);

  const nextFlowNodes = useMemo<SignalFlowNodeType[]>(() => {
    return graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      draggable: layoutMode === 'manual',
      data: {
        label: node.label,
        subtitle: node.type === 'agent'
          ? [
              node.status,
              node.energyPhase ? (PHASE_LABELS[node.energyPhase] ?? node.energyPhase) : null,
            ].filter(Boolean).join(' · ')
          : node.status,
        nodeType: node.type,
        energyPhase: node.energyPhase,
        isDormant: node.isDormant,
      },
    }));
  }, [graph.nodes, layoutMode]);
  const [flowNodes, setFlowNodes, onFlowNodesChange] = useNodesState<SignalFlowNodeType>(nextFlowNodes);

  useEffect(() => {
    setFlowNodes(nextFlowNodes);
  }, [nextFlowNodes, setFlowNodes]);

  const flowEdges = useMemo<FlowEdge[]>(() => {
    return graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: edge.active,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
      },
      style: edge.active
        ? { stroke: activeEdgeColor, strokeWidth: 1.7 }
        : { stroke: inactiveEdgeColor, strokeWidth: 1.2, strokeDasharray: '5 4' },
      label: edge.label,
      labelStyle: {
        fill: edgeLabelColor,
        fontSize: 10,
        fontWeight: 500,
      },
      labelBgStyle: {
        fill: edgeLabelBgColor,
        fillOpacity: 0.95,
      },
      data: {
        active: edge.active,
      },
    }));
  }, [activeEdgeColor, edgeLabelBgColor, edgeLabelColor, graph.edges, inactiveEdgeColor]);

  useEffect(() => {
    const instance = flowInstanceRef.current;
    if (!instance) return;

    if (layoutMode === 'auto:flow') {
      void instance.fitView({ padding: 0.2 });
      return;
    }

    if (manualViewport) {
      const currentViewport = instance.getViewport();
      const matchesCurrentViewport =
        Math.abs(currentViewport.x - manualViewport.x) < 0.5
        && Math.abs(currentViewport.y - manualViewport.y) < 0.5
        && Math.abs(currentViewport.zoom - manualViewport.zoom) < 0.001;
      if (!matchesCurrentViewport) {
        void instance.setViewport(manualViewport, { duration: 0 });
      }
      return;
    }

    void instance.fitView({ padding: 0.2 });
  }, [layoutMode, manualViewport]);

  return (
    <section
      data-testid="agent-topology-view"
      className="h-full min-h-0"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClearSelection();
        }
      }}
    >
      <div
        data-testid="agent-topology-canvas"
        className="relative h-full min-h-0 w-full overflow-hidden bg-[#FAF7F5] dark:bg-[#1C1917]"
      >
        <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-wrap items-center justify-end gap-2">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-[#E7E3E0] bg-white/90 p-1 shadow-sm backdrop-blur dark:border-[#3C3836] dark:bg-[#1C1917]/90">
            <button
              type="button"
              data-testid="agent-topology-layout-mode-manual"
              onClick={() => onLayoutModeChange('manual')}
              className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                layoutMode === 'manual'
                  ? 'bg-[#C75B3A] text-white'
                  : 'text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]'
              }`}
            >
              手动布局
            </button>
            <button
              type="button"
              data-testid="agent-topology-layout-mode-auto-flow"
              onClick={() => onLayoutModeChange('auto:flow')}
              className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                layoutMode === 'auto:flow'
                  ? 'bg-[#1D4ED8] text-white'
                  : 'text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]'
              }`}
            >
              自动布局
            </button>
          </div>
          <button
            type="button"
            data-testid="agent-topology-fit-view"
            onClick={() => {
              void flowInstanceRef.current?.fitView({ padding: 0.2 });
            }}
            className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-[#E7E3E0] bg-white/90 px-3 py-1 text-[11px] font-medium text-[#57534E] shadow-sm backdrop-blur transition-colors hover:text-[#1C1917] dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]"
          >
            <Crosshair size={12} />
            适配视口
          </button>
          <button
            type="button"
            data-testid="agent-topology-reset-layout"
            onClick={onResetCurrentLayout}
            className="pointer-events-auto rounded-full border border-[#E7E3E0] bg-white/90 px-3 py-1 text-[11px] font-medium text-[#57534E] shadow-sm backdrop-blur transition-colors hover:text-[#1C1917] dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]"
          >
            重置当前布局
          </button>
          <button
            type="button"
            data-testid="agent-topology-clear-layouts"
            onClick={onClearSavedLayouts}
            className="pointer-events-auto rounded-full border border-[#E7E3E0] bg-white/90 px-3 py-1 text-[11px] font-medium text-[#57534E] shadow-sm backdrop-blur transition-colors hover:text-[#1C1917] dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]"
          >
            清空已保存布局
          </button>
        </div>
        <ReactFlow
          data-testid="agent-signal-flow"
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={SIGNAL_NODE_TYPES}
          defaultViewport={layoutMode === 'manual' ? manualViewport : undefined}
          fitView={layoutMode === 'auto:flow' || !manualViewport}
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={1.8}
          onNodesChange={onFlowNodesChange}
          onInit={(instance) => {
            flowInstanceRef.current = instance;
            if (layoutMode === 'manual' && manualViewport) {
              void instance.setViewport(manualViewport, { duration: 0 });
              return;
            }
            void instance.fitView({ padding: 0.2 });
          }}
          onNodeDragStop={(_, node) => {
            if (layoutMode !== 'manual') return;
            onCommitNodePosition(node.id, node.position, flowInstanceRef.current?.getViewport());
          }}
          onMoveEnd={(_, viewport) => {
            if (layoutMode !== 'manual') return;
            onCommitViewport(viewport);
          }}
          onNodeClick={(_, node: SignalFlowNodeType) => {
            onSelectNode(node.id);
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} color={backgroundDotColor} />
          <Controls showInteractive className="agent-topology-controls" />
        </ReactFlow>
      </div>
    </section>
  );
}
