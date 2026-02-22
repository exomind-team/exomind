import { Bot, Heart, Plus, Shield } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type AgentStatus = 'active' | 'sleeping';

interface AgentCardData {
  id: string;
  name: string;
  desc: string;
  model: string;
  status: AgentStatus;
  icon: LucideIcon;
}

const MOCK_AGENTS: AgentCardData[] = [
  {
    id: 'governor',
    name: 'Governor',
    desc: '系统守护者 · 抑制冲动决策',
    model: 'Claude Opus',
    status: 'active',
    icon: Shield,
  },
  {
    id: 'growth-coach',
    name: 'Growth Coach',
    desc: '成长教练 · 长期目标追踪',
    model: 'Claude Sonnet',
    status: 'sleeping',
    icon: Heart,
  },
  {
    id: 'task-system',
    name: 'Task System',
    desc: '任务分解与执行 · 优先级管理',
    model: 'Claude Haiku',
    status: 'active',
    icon: Bot,
  },
];

function AgentCard({ agent }: { agent: AgentCardData }) {
  const Icon = agent.icon;
  return (
    <div className="relative h-[140px] w-full overflow-hidden rounded-[20px]">
      {/* 光晕背景 */}
      <div
        className="absolute left-4 top-[18px] h-[120px] w-[321px] rounded-[20px] blur-[8px]"
        style={{ background: 'linear-gradient(145deg, #EDADA0 0%, #E08E7A 50%, #D4785F 100%)' }}
      />
      {/* 毛玻璃卡片内容 */}
      <div
        className="absolute inset-[8px] flex items-start gap-[14px] rounded-[20px] border border-white/50 p-[16px_18px] backdrop-blur-[24px]"
        style={{ background: 'rgba(255,255,255,0.63)' }}
      >
        {/* Avatar */}
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[22px]"
          style={{ background: 'linear-gradient(145deg, #E8866F 0%, #C75B3A 100%)' }}
        >
          <Icon size={22} className="text-white" />
        </div>
        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold leading-[1.3] text-[#1C1917]">{agent.name}</span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium',
                agent.status === 'active'
                  ? 'bg-[#C75B3A]/10 text-[#C75B3A]'
                  : 'bg-[#A8A29E]/10 text-[#A8A29E]'
              )}
            >
              {agent.status === 'active' ? '活跃' : '休眠'}
            </span>
          </div>
          <span className="text-[12px] leading-[1.4] text-[#A8A29E]">{agent.desc}</span>
          <span className="mt-1 text-[11px] text-[#A8A29E]">{agent.model}</span>
        </div>
      </div>
    </div>
  );
}

export function AgentsPage() {
  return (
    <div className="flex h-full flex-col">
      {/* Status Bar 占位 */}
      <div className="h-[54px] shrink-0" />

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3">
        <span className="text-[18px] font-semibold leading-[1.5] text-[#1C1917]">Agents</span>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-[18px] bg-[#F5F0ED]"
        >
          <Plus size={18} className="text-[#1C1917]" />
        </button>
      </div>

      {/* Card Area */}
      <div className="flex flex-1 flex-col gap-[14px] overflow-y-auto px-5 pb-4 pt-2">
        {MOCK_AGENTS.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  );
}
