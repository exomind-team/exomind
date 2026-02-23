import { Bot, List, Monitor, Plus, Settings, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getAgentHubService } from '@/lib/services';
import type {
  AgentAddNodeOption,
  AgentDeviceGroup,
  AgentHubListSection,
  AgentHubNode,
  AgentHubTopologyData,
  AgentHubViewMode,
} from '@/lib/types/agent-hub';

const VIEW_ITEMS: Array<{ id: AgentHubViewMode; icon: React.ComponentType<{ size?: number }>; label: string }> = [
  { id: 'topology', icon: Bot, label: '拓扑' },
  { id: 'list', icon: List, label: '列表' },
  { id: 'device', icon: Monitor, label: '设备' },
];

function ViewToggle({
  value,
  onChange,
}: {
  value: AgentHubViewMode;
  onChange: (value: AgentHubViewMode) => void;
}) {
  return (
    <div className="flex items-center rounded-[10px] bg-[#F5F0ED] p-1">
      {VIEW_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            data-testid={`agent-view-toggle-${item.id}`}
            onClick={() => onChange(item.id)}
            aria-pressed={active}
            className={`flex h-7 w-8 items-center justify-center rounded-[8px] transition ${
              active
                ? 'bg-white text-[#1C1917] shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                : 'text-[#78716C]'
            }`}
            title={item.label}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}

function NodeBadge({
  node,
  selected,
  onSelect,
}: {
  node: AgentHubNode;
  selected: boolean;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <button
      type="button"
      data-testid={`agent-topology-node-${node.id}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}
      className={`flex min-w-[64px] flex-col items-center gap-1 rounded-2xl border px-2 py-2 transition ${
        selected
          ? 'scale-[1.03] border-[#C75B3A] bg-white shadow-[0_6px_18px_-8px_rgba(199,91,58,0.8)]'
          : 'border-[#E7E5E4] bg-white'
      }`}
      style={!selected ? { opacity: 1 } : undefined}
    >
      <span
        className="inline-block h-8 w-8 rounded-full"
        style={{ backgroundColor: `${node.brandColor}22`, border: `1px solid ${node.brandColor}66` }}
      />
      <span className="text-[10px] font-medium text-[#57534E]">{node.name}</span>
    </button>
  );
}

function TopologyView({
  topology,
  selectedNodeId,
  onSelectNode,
  onClearSelection,
}: {
  topology: AgentHubTopologyData;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
}) {
  const topNodes = topology.nodes.filter((node) => node.layer === 'top');
  const middleNodes = topology.nodes.filter((node) => node.layer === 'middle');
  const bottomNodes = topology.nodes.filter((node) => node.layer === 'bottom');
  const selectedNode = topology.nodes.find((item) => item.id === selectedNodeId) ?? null;

  return (
    <section
      data-testid="agent-topology-view"
      className="space-y-3"
      onClick={onClearSelection}
    >
      <div className="rounded-[10px] bg-[#F5F0ED] px-3 py-1 text-[11px] font-semibold text-[#A8A29E]">输出节点</div>
      <div className="flex flex-wrap gap-2 px-1">
        {topNodes.map((node) => (
          <NodeBadge key={node.id} node={node} selected={node.id === selectedNodeId} onSelect={onSelectNode} />
        ))}
      </div>

      <div className="rounded-[10px] bg-[#F5F0ED] px-3 py-1 text-[11px] font-semibold text-[#A8A29E]">Agent / Actor</div>
      <div className="flex flex-wrap gap-2 px-1">
        {middleNodes.map((node) => (
          <NodeBadge key={node.id} node={node} selected={node.id === selectedNodeId} onSelect={onSelectNode} />
        ))}
      </div>

      <div className="rounded-[10px] bg-[#F5F0ED] px-3 py-1 text-[11px] font-semibold text-[#A8A29E]">信号输入</div>
      <div className="flex flex-wrap gap-2 px-1">
        {bottomNodes.map((node) => (
          <NodeBadge key={node.id} node={node} selected={node.id === selectedNodeId} onSelect={onSelectNode} />
        ))}
      </div>

      {selectedNode && (
        <div
          data-testid="agent-topology-node-detail-card"
          className="rounded-2xl border border-[#E7E5E4] bg-[#1C1917] px-4 py-3 text-white"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="text-sm font-semibold">{selectedNode.name}</p>
          <p className="mt-1 text-xs text-white/80">状态：{selectedNode.status}</p>
          <p className="mt-1 text-xs text-white/60">类型：{selectedNode.type}</p>
        </div>
      )}
    </section>
  );
}

function ListView({ sections }: { sections: AgentHubListSection[] }) {
  return (
    <section data-testid="agent-list-view" className="space-y-4">
      {sections.map((section) => (
        <article key={section.id} className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-[#78716C]">{section.title}</h3>
            <span className="rounded-md bg-[#F5F0ED] px-2 py-0.5 text-[11px] text-[#78716C]">{section.count}</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white">
            {section.items.map((item, index) => (
              <div key={item.id}>
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-[#1C1917]">{item.name}</p>
                    <p className="text-xs text-[#A8A29E]">{item.description}</p>
                  </div>
                  <span className="text-[11px] text-[#78716C]">{item.status}</span>
                </div>
                {index !== section.items.length - 1 && <div className="h-px bg-[#F5F0ED]" />}
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

function DeviceView({ groups }: { groups: AgentDeviceGroup[] }) {
  return (
    <section data-testid="agent-device-view" className="space-y-4">
      {groups.map((group) => (
        <article key={group.id} className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-[#78716C]">{group.title}</h3>
            <span className="text-[11px] text-[#A8A29E]">{group.summary}</span>
          </div>
          <div className="space-y-2">
            {group.cards.map((card) => (
              <div key={card.id} className="rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#1C1917]">{card.name}</p>
                    <p className="text-xs text-[#A8A29E]">{card.summary}</p>
                  </div>
                  {card.isHost && <span className="rounded bg-[#C75B3A15] px-2 py-0.5 text-[11px] text-[#C75B3A]">本机</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {card.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="rounded-md px-2 py-0.5 text-[11px]"
                      style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

function AddNodeSheet({
  options,
  onClose,
}: {
  options: AgentAddNodeOption[];
  onClose: () => void;
}) {
  return (
    <>
      <button
        type="button"
        data-testid="agent-add-node-overlay"
        aria-label="关闭添加节点弹窗（Close Add Node Sheet）"
        className="absolute inset-0 bg-black/35"
        onClick={onClose}
      />
      <section
        data-testid="agent-add-node-sheet"
        className="absolute inset-x-0 bottom-0 z-10 rounded-t-[24px] bg-white pb-7"
      >
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 rounded bg-[#D6D3D1]" />
        </div>
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="text-[18px] font-bold text-[#1C1917]">添加节点</h2>
          <button
            type="button"
            data-testid="agent-add-node-close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-2 px-5">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="flex w-full items-center justify-between rounded-2xl bg-[#FAF7F5] px-4 py-3 text-left"
            >
              <div>
                <p className="text-sm font-semibold text-[#1C1917]">{option.title}</p>
                <p className="mt-1 text-xs text-[#78716C]">{option.description}</p>
              </div>
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: option.tintColor }} />
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

export function AgentsPage() {
  const [viewMode, setViewMode] = useState<AgentHubViewMode>('topology');
  const [topology, setTopology] = useState<AgentHubTopologyData>({ nodes: [], edges: [], selectedNodeId: null });
  const [listSections, setListSections] = useState<AgentHubListSection[]>([]);
  const [deviceGroups, setDeviceGroups] = useState<AgentDeviceGroup[]>([]);
  const [addNodeOptions, setAddNodeOptions] = useState<AgentAddNodeOption[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    let disposed = false;
    const service = getAgentHubService();
    const load = async () => {
      const [nextTopology, nextList, nextDevice, nextAddOptions] = await Promise.all([
        service.getTopology(),
        service.getListView(),
        service.getDeviceView(),
        service.listAddNodeOptions(),
      ]);
      if (disposed) return;
      setTopology(nextTopology);
      setSelectedNodeId(nextTopology.selectedNodeId ?? null);
      setListSections(nextList);
      setDeviceGroups(nextDevice);
      setAddNodeOptions(nextAddOptions);
    };
    void load();
    return () => {
      disposed = true;
    };
  }, []);

  const content = useMemo(() => {
    if (viewMode === 'list') {
      return <ListView sections={listSections} />;
    }
    if (viewMode === 'device') {
      return <DeviceView groups={deviceGroups} />;
    }
    return (
      <TopologyView
        topology={topology}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        onClearSelection={() => setSelectedNodeId(null)}
      />
    );
  }, [deviceGroups, listSections, selectedNodeId, topology, viewMode]);

  return (
    <div data-testid="agent-hub-page" className="relative min-h-full bg-[#FAF7F5]">
      <header className="flex items-center justify-between px-5 py-3">
        <h1 className="text-[20px] font-bold leading-[1.5] text-[#1C1917]">Agent 网络</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F5F0ED] text-[#78716C]"
            aria-label="拓扑设置（Topology Settings）"
          >
            <Settings size={18} />
          </button>
          <ViewToggle value={viewMode} onChange={setViewMode} />
          <button
            type="button"
            data-testid="agent-add-node-button"
            onClick={() => setSheetOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#C75B3A] text-white"
            aria-label="添加节点（Add Node）"
          >
            <Plus size={18} />
          </button>
        </div>
      </header>

      <div className="px-5 pb-[calc(env(safe-area-inset-bottom,0px)+108px)] pt-2">
        {content}
      </div>

      {sheetOpen && <AddNodeSheet options={addNodeOptions} onClose={() => setSheetOpen(false)} />}
    </div>
  );
}

