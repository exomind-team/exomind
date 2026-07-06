import {
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  GitBranch,
  PauseCircle,
  Play,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  TimerReset,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getIntentProgramService } from '@/lib/services';
import type {
  IntentProgram,
  IntentProgramAuditEvent,
  IntentProgramMetrics,
  IntentProgramRunRecord,
} from '@/lib/types/intent-program';

const STATE_LABELS: Record<IntentProgram['state'], string> = {
  draft: '草稿',
  authored: '已著作',
  delegated: '已委托',
  running: '运行中',
  awaiting_review: '人核待验收',
  accepted: '已接受',
  overridden: '已覆写',
  paused: '已暂停',
  expired: '已到期',
  needs_reauthoring: '待重新著作',
  retired: '已退役',
};

const STATE_CLASS: Record<IntentProgram['state'], string> = {
  draft: 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]',
  authored: 'bg-[#EEF2FF] text-[#4F46E5] dark:bg-[#24243A] dark:text-[#A5B4FC]',
  delegated: 'bg-[#F0FDF4] text-[#16A34A] dark:bg-[#173121] dark:text-[#86EFAC]',
  running: 'bg-[#EFF6FF] text-[#2563EB] dark:bg-[#1C2D45] dark:text-[#93C5FD]',
  awaiting_review: 'bg-[#FFF7ED] text-[#C75B3A] dark:bg-[#3A2A22] dark:text-[#FDBA74]',
  accepted: 'bg-[#F0FDF4] text-[#16A34A] dark:bg-[#173121] dark:text-[#86EFAC]',
  overridden: 'bg-[#FEF2F2] text-[#DC2626] dark:bg-[#3A2323] dark:text-[#FCA5A5]',
  paused: 'bg-[#FEFCE8] text-[#A16207] dark:bg-[#332D16] dark:text-[#FDE68A]',
  expired: 'bg-[#F5F0ED] text-[#57534E] dark:bg-[#292524] dark:text-[#D6D3D1]',
  needs_reauthoring: 'bg-[#FEF2F2] text-[#B91C1C] dark:bg-[#3A2323] dark:text-[#FCA5A5]',
  retired: 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]',
};

const EMPTY_METRICS: IntentProgramMetrics = {
  total: 0,
  delegated: 0,
  awaitingHumanReview: 0,
  needsReauthoring: 0,
  averageSovereigntyScore: 0,
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatEventTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function compactText(value: string, maxLength = 78): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function MetricsBar({ metrics }: { metrics: IntentProgramMetrics }) {
  const items = [
    { label: '卡组总数', value: String(metrics.total), icon: FileCheck2 },
    { label: '已委托', value: String(metrics.delegated), icon: ShieldCheck },
    { label: '待验收数', value: String(metrics.awaitingHumanReview), icon: CircleAlert },
    { label: '再著作数', value: String(metrics.needsReauthoring), icon: RotateCcw },
  ];

  return (
    <section className="grid grid-cols-2 gap-2" data-testid="intent-program-metrics">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <article key={item.label} className="rounded-xl border border-[#E7E5E4] bg-white px-3 py-2 dark:border-[#292524] dark:bg-[#1C1917]">
            <div className="flex items-center gap-2 text-[#78716C] dark:text-[#A8A29E]">
              <Icon size={14} />
              <span className="text-[11px]">{item.label}</span>
            </div>
            <p className="mt-1 text-xl font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{item.value}</p>
          </article>
        );
      })}
      <article className="col-span-2 rounded-xl border border-[#E7E5E4] bg-[#1C1917] px-3 py-2 text-white dark:border-[#44403C] dark:bg-[#0C0A09]">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] text-white/60">主权完整度</p>
            <p className="text-xl font-semibold">{metrics.averageSovereigntyScore}%</p>
          </div>
          <div className="h-1.5 w-32 rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-[#FDBA74]"
              style={{ width: `${Math.max(0, Math.min(100, metrics.averageSovereigntyScore))}%` }}
            />
          </div>
        </div>
      </article>
    </section>
  );
}

function GuardrailList({ program }: { program: IntentProgram }) {
  return (
    <div className="flex flex-wrap gap-1">
      {program.guardrails.map((guardrail) => (
        <span
          key={guardrail.id}
          className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${
            guardrail.enforced
              ? 'bg-[#ECFDF5] text-[#047857] dark:bg-[#123629] dark:text-[#6EE7B7]'
              : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]'
          }`}
        >
          {guardrail.enforced ? '强制' : '提示'} · {guardrail.label}
        </span>
      ))}
    </div>
  );
}

function AuditTrail({ events }: { events: IntentProgramAuditEvent[] }) {
  return (
    <section className="space-y-2 rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#ECFDF5] text-[#047857] dark:bg-[#123629] dark:text-[#6EE7B7]">
            <ScrollText size={15} />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">EventLog 对账</p>
            <p className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">canonical truth source</p>
          </div>
        </div>
        <span className="rounded-md bg-[#F5F0ED] px-2 py-0.5 text-[10px] font-semibold text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
          {events.length} 条
        </span>
      </div>

      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#D6D3D1] px-3 py-2 text-[11px] text-[#A8A29E] dark:border-[#44403C] dark:text-[#78716C]">
          暂无意图程序主权事件。运行、接受、覆写或再认证后会写入 EventLog。
        </p>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <article key={event.id} className="rounded-xl bg-[#FAF7F5] px-3 py-2 dark:bg-[#292524]">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[11px] font-semibold text-[#57534E] dark:text-[#E7E5E4]">{event.id}</p>
                <span className="shrink-0 text-[10px] text-[#A8A29E] dark:text-[#B8B1AC]">{formatEventTime(event.timestamp)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-[#57534E] dark:text-[#D6D3D1]">
                {compactText(event.content, 120)}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {event.tags.map((tag) => (
                  <span key={tag} className="rounded-md bg-white px-2 py-0.5 text-[10px] text-[#78716C] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
                    {tag}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function LatestRun({ program, onAccept, onOverride }: {
  program: IntentProgram;
  onAccept: (programId: string, run: IntentProgramRunRecord) => Promise<void>;
  onOverride: (programId: string, run: IntentProgramRunRecord) => Promise<void>;
}) {
  const run = program.runs[0];
  if (!run) {
    return (
      <div className="rounded-xl border border-dashed border-[#D6D3D1] px-3 py-2 text-[11px] text-[#A8A29E] dark:border-[#44403C] dark:text-[#78716C]">
        尚无执行记录。第一次试运行会留下输入、执行器、机器输出与人类裁决。
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-2 dark:border-[#292524] dark:bg-[#292524]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-[#57534E] dark:text-[#E7E5E4]">执行记录 {run.id}</p>
        <span className="rounded-md bg-white px-2 py-0.5 text-[10px] text-[#78716C] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
          执行：{run.state}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-[11px] leading-5 text-[#57534E] dark:text-[#D6D3D1]">{run.machineOutput}</p>
      <p className="text-[10px] text-[#A8A29E] dark:text-[#B8B1AC]">{run.verificationSnapshot}</p>
      {run.decisionNote ? (
        <p className="rounded-lg bg-white px-2 py-1 text-[11px] text-[#C75B3A] dark:bg-[#1C1917] dark:text-[#FDBA74]">{run.decisionNote}</p>
      ) : null}
      {run.state === 'awaiting_review' ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              void onAccept(program.id, run);
            }}
            className="flex h-8 items-center justify-center gap-1 rounded-lg bg-[#16A34A] text-[11px] font-semibold text-white"
            aria-label={`接受执行记录 ${run.id}`}
          >
            <CheckCircle2 size={13} />
            接受
          </button>
          <button
            type="button"
            onClick={() => {
              void onOverride(program.id, run);
            }}
            className="flex h-8 items-center justify-center gap-1 rounded-lg bg-[#C75B3A] text-[11px] font-semibold text-white"
            aria-label={`覆写执行记录 ${run.id}`}
          >
            <GitBranch size={13} />
            覆写
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ProgramCard({
  program,
  onRun,
  onAccept,
  onOverride,
  onRecertPass,
  onRecertPartial,
  onRecertFail,
  onPause,
  onRetire,
}: {
  program: IntentProgram;
  onRun: (programId: string) => Promise<void>;
  onAccept: (programId: string, run: IntentProgramRunRecord) => Promise<void>;
  onOverride: (programId: string, run: IntentProgramRunRecord) => Promise<void>;
  onRecertPass: (programId: string) => Promise<void>;
  onRecertPartial: (programId: string) => Promise<void>;
  onRecertFail: (programId: string) => Promise<void>;
  onPause: (programId: string) => Promise<void>;
  onRetire: (programId: string) => Promise<void>;
}) {
  const blocked = program.state === 'draft'
    || program.state === 'authored'
    || program.state === 'running'
    || program.state === 'awaiting_review'
    || program.state === 'overridden'
    || program.state === 'paused'
    || program.state === 'expired'
    || program.state === 'needs_reauthoring'
    || program.state === 'retired';
  const recertificationBlocked = program.state === 'draft'
    || program.state === 'authored'
    || program.state === 'running'
    || program.state === 'awaiting_review'
    || program.state === 'retired';

  return (
    <article
      data-testid={`intent-program-card-${program.id}`}
      className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-[#F5F0ED] px-2 py-0.5 text-[10px] font-semibold text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
              {program.lane} 道
            </span>
            <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${STATE_CLASS[program.state]}`}>
              {STATE_LABELS[program.state]}
            </span>
            <span className="rounded-md bg-[#F5F0ED] px-2 py-0.5 text-[10px] font-semibold text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
              {program.state}
            </span>
            {blocked ? (
              <span className="rounded-md bg-[#FEF2F2] px-2 py-0.5 text-[10px] font-semibold text-[#B91C1C] dark:bg-[#3A2323] dark:text-[#FCA5A5]">
                运行权已阻断
              </span>
            ) : null}
          </div>
          <h2 className="mt-2 text-[15px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{program.title}</h2>
          <p className="mt-1 text-[12px] leading-5 text-[#78716C] dark:text-[#D6D3D1]">{compactText(program.intent, 108)}</p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFF7ED] text-[#C75B3A] dark:bg-[#3A2A22] dark:text-[#FDBA74]">
          {program.state === 'needs_reauthoring' ? <RotateCcw size={16} /> : <ShieldCheck size={16} />}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-xl bg-[#FAF7F5] px-3 py-2 dark:bg-[#292524]">
          <p className="text-[#A8A29E] dark:text-[#78716C]">触发</p>
          <p className="mt-1 text-[#44403C] dark:text-[#E7E5E4]">{compactText(program.trigger, 46)}</p>
        </div>
        <div className="rounded-xl bg-[#FAF7F5] px-3 py-2 dark:bg-[#292524]">
          <p className="text-[#A8A29E] dark:text-[#78716C]">再认证</p>
          <p className="mt-1 text-[#44403C] dark:text-[#E7E5E4]">{program.recertification.cadenceDays} 天 · {formatDate(program.recertification.nextReviewAt)}</p>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-[#57534E] dark:text-[#E7E5E4]">装置化禁令</p>
        <GuardrailList program={program} />
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-[#57534E] dark:text-[#E7E5E4]">人核闸门</p>
        <p className="text-[11px] leading-5 text-[#78716C] dark:text-[#D6D3D1]">{program.humanGate.requiredWhen.join('；')}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-xl border border-[#E7E5E4] px-3 py-2 dark:border-[#292524]">
          <p className="font-semibold text-[#57534E] dark:text-[#E7E5E4]">验证标准</p>
          <p className="mt-1 text-[#78716C] dark:text-[#D6D3D1]">claim/method/source/verdict</p>
        </div>
        <div className="rounded-xl border border-[#E7E5E4] px-3 py-2 dark:border-[#292524]">
          <p className="font-semibold text-[#57534E] dark:text-[#E7E5E4]">真相源</p>
          <p className="mt-1 text-[#78716C] dark:text-[#D6D3D1]">EventLog canonical</p>
        </div>
      </div>

      <LatestRun program={program} onAccept={onAccept} onOverride={onOverride} />

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={blocked}
          onClick={() => {
            void onRun(program.id);
          }}
          className="flex h-9 items-center justify-center gap-1 rounded-xl bg-[#1C1917] text-[12px] font-semibold text-white disabled:bg-[#D6D3D1] disabled:text-[#78716C] dark:bg-[#FAFAF9] dark:text-[#1C1917] dark:disabled:bg-[#44403C] dark:disabled:text-[#A8A29E]"
          aria-label={`试运行 ${program.title}`}
        >
          <Play size={13} />
          试运行
        </button>
        <button
          type="button"
          disabled={recertificationBlocked}
          onClick={() => {
            void onRecertPass(program.id);
          }}
          className="flex h-9 items-center justify-center gap-1 rounded-xl bg-[#ECFDF5] text-[12px] font-semibold text-[#047857] disabled:bg-[#D6D3D1] disabled:text-[#78716C] dark:bg-[#123629] dark:text-[#6EE7B7] dark:disabled:bg-[#44403C] dark:disabled:text-[#A8A29E]"
          aria-label={`再认证通过 ${program.title}`}
        >
          <CheckCircle2 size={13} />
          通过
        </button>
        <button
          type="button"
          disabled={recertificationBlocked}
          onClick={() => {
            void onRecertPartial(program.id);
          }}
          className="flex h-9 items-center justify-center gap-1 rounded-xl bg-[#FEFCE8] text-[12px] font-semibold text-[#A16207] disabled:bg-[#D6D3D1] disabled:text-[#78716C] dark:bg-[#332D16] dark:text-[#FDE68A] dark:disabled:bg-[#44403C] dark:disabled:text-[#A8A29E]"
          aria-label={`再认证部分通过 ${program.title}`}
        >
          <PauseCircle size={13} />
          部分通过
        </button>
        <button
          type="button"
          disabled={recertificationBlocked}
          onClick={() => {
            void onRecertFail(program.id);
          }}
          className="flex h-9 items-center justify-center gap-1 rounded-xl bg-[#F5F0ED] text-[12px] font-semibold text-[#57534E] disabled:bg-[#D6D3D1] disabled:text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1] dark:disabled:bg-[#44403C] dark:disabled:text-[#A8A29E]"
          aria-label={`再认证失败 ${program.title}`}
        >
          <TimerReset size={13} />
          再认证失败
        </button>
        <button
          type="button"
          onClick={() => {
            void onPause(program.id);
          }}
          className="flex h-9 items-center justify-center gap-1 rounded-xl bg-[#FEFCE8] text-[12px] font-semibold text-[#A16207] dark:bg-[#332D16] dark:text-[#FDE68A]"
          aria-label={`暂停 ${program.title}`}
        >
          <PauseCircle size={13} />
          暂停
        </button>
        <button
          type="button"
          onClick={() => {
            void onRetire(program.id);
          }}
          className="flex h-9 items-center justify-center gap-1 rounded-xl bg-[#F5F0ED] text-[12px] font-semibold text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]"
          aria-label={`退役 ${program.title}`}
        >
          <RotateCcw size={13} />
          退役
        </button>
      </div>
    </article>
  );
}

export function IntentProgramsPage() {
  const [programs, setPrograms] = useState<IntentProgram[]>([]);
  const [auditEvents, setAuditEvents] = useState<IntentProgramAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<'all' | 'gate' | 'reauthor'>('all');
  const service = useMemo(() => getIntentProgramService(), []);

  const reload = async () => {
    const [next, events] = await Promise.all([
      service.listPrograms(),
      service.listSovereigntyEvents(6),
    ]);
    setPrograms(next);
    setAuditEvents(events);
    setLoading(false);
  };

  const reloadAuditEvents = async () => {
    const events = await service.listSovereigntyEvents(6);
    setAuditEvents(events);
  };

  useEffect(() => {
    void reload();
  }, []);

  const metrics = useMemo(() => service.calculateMetrics(programs), [programs, service]);

  const visiblePrograms = useMemo(() => {
    if (activeFilter === 'gate') {
      return programs.filter((program) => program.state === 'awaiting_review');
    }
    if (activeFilter === 'reauthor') {
      return programs.filter((program) => program.state === 'needs_reauthoring' || program.state === 'expired');
    }
    return programs;
  }, [activeFilter, programs]);

  const replaceProgram = (updated: IntentProgram) => {
    setPrograms((prev) => prev.map((program) => (program.id === updated.id ? updated : program)));
  };

  const handleRun = async (programId: string) => {
    const result = await service.runProgram(programId);
    replaceProgram(result.program);
    await reloadAuditEvents();
  };

  const handleAccept = async (programId: string, run: IntentProgramRunRecord) => {
    const updated = await service.acceptRun(programId, run.id, '人核已核对来源、验证项与风险边界。');
    replaceProgram(updated);
    await reloadAuditEvents();
  };

  const handleOverride = async (programId: string, run: IntentProgramRunRecord) => {
    const updated = await service.overrideRun(programId, run.id, '人核覆写：先补证据链与红灯测试，再允许进入下一步。');
    replaceProgram(updated);
    await reloadAuditEvents();
  };

  const handleRecertPass = async (programId: string) => {
    const updated = await service.recertifyProgram(programId, {
      verdict: 'pass',
      note: '我仍能解释这张卡的来源策略、验收标准与撤回边界。',
    });
    replaceProgram(updated);
    await reloadAuditEvents();
  };

  const handleRecertPartial = async (programId: string) => {
    const updated = await service.recertifyProgram(programId, {
      verdict: 'partial',
      note: '我只能解释部分边界，先降级暂停，补完著作再委托。',
    });
    replaceProgram(updated);
    await reloadAuditEvents();
  };

  const handleRecertFail = async (programId: string) => {
    const updated = await service.recertifyProgram(programId, {
      verdict: 'fail',
      note: '我现在解释不清这张卡的来源策略与验收标准。',
    });
    replaceProgram(updated);
    await reloadAuditEvents();
  };

  const handlePause = async (programId: string) => {
    const updated = await service.pauseProgram(programId, '人核暂停：当前验收预算或掌控状态不足。');
    replaceProgram(updated);
    await reloadAuditEvents();
  };

  const handleRetire = async (programId: string) => {
    const updated = await service.retireProgram(programId, '人核退役：这张委托不再服务当前生活系统。');
    replaceProgram(updated);
    await reloadAuditEvents();
  };

  return (
    <div className="min-h-full bg-[#FAF7F5] dark:bg-[#0C0A09]" data-testid="intent-programs-page">
      <header className="flex items-center justify-between px-5 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#C75B3A] dark:text-[#FDBA74]">Intent Deck</p>
          <h1 className="text-lg font-semibold text-[#1C1917] dark:text-[#FAFAF9]">意图程序</h1>
        </div>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]"
          aria-label="意图程序筛选（Intent Program Filters）"
        >
          <SlidersHorizontal size={18} />
        </button>
      </header>

      <main className="space-y-4 px-5 pb-[calc(env(safe-area-inset-bottom,0px)+108px)]">
        <MetricsBar metrics={metrics ?? EMPTY_METRICS} />

        <section className="rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFF7ED] text-[#C75B3A] dark:bg-[#3A2A22] dark:text-[#FDBA74]">
              <PauseCircle size={16} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">路径三运行核</p>
              <p className="mt-1 text-[12px] leading-5 text-[#78716C] dark:text-[#D6D3D1]">
                信号触发、提案闸门、EventLog、再认证被收束为同一张卡。Agent 只产出候选，人核裁决才进入真相源。
              </p>
            </div>
          </div>
        </section>

        <AuditTrail events={auditEvents} />

        <div className="flex gap-2 overflow-x-auto pb-1">
          {[
            { id: 'all' as const, label: '全部' },
            { id: 'gate' as const, label: '人核闸门' },
            { id: 'reauthor' as const, label: '再著作' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveFilter(item.id)}
              className={`shrink-0 rounded-2xl px-4 py-1.5 text-[13px] ${
                activeFilter === item.id
                  ? 'bg-[#C75B3A] font-semibold text-white'
                  : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="rounded-2xl border border-[#E7E5E4] bg-white px-4 py-5 text-sm text-[#78716C] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
            正在载入意图程序...
          </p>
        ) : (
          <div className="space-y-3">
            {visiblePrograms.map((program) => (
              <ProgramCard
                key={program.id}
                program={program}
                onRun={handleRun}
                onAccept={handleAccept}
                onOverride={handleOverride}
                onRecertPass={handleRecertPass}
                onRecertPartial={handleRecertPartial}
                onRecertFail={handleRecertFail}
                onPause={handlePause}
                onRetire={handleRetire}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
