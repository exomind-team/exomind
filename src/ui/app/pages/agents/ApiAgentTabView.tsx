import { Bot, RefreshCw, Send, Sparkles, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { listProviderProfiles, resolveProviderProfile } from '@/lib/agent-provider/provider-profile-storage';
import { AgentSessionRtAdapter } from '@/lib/adapters/agent-session-rt-adapter';
import type {
  ApiAgentSessionRecord,
  ApiAgentToolDefinition,
  ApiAgentTurnItem,
} from '@/lib/types/agent-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const DEFAULT_SYSTEM_PROMPT = 'You are ExoMind API Agent tester.'; // API Agent 调试系统提示词
const DEFAULT_TOOLS_JSON = JSON.stringify([], null, 2);
const WEATHER_TOOL_JSON = JSON.stringify([
  {
    name: 'get_weather',
    description: 'Read current weather snapshot',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
      },
      required: ['city'],
    },
  },
], null, 2);

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function buildNextHistory(
  previousHistory: ApiAgentTurnItem[],
  response: ApiAgentSessionRecord,
): ApiAgentTurnItem[] {
  return [
    ...previousHistory,
    {
      role: 'assistant',
      content: response.assistantTurn.content,
      toolCalls: response.assistantTurn.toolCalls,
    },
  ];
}

function tryParseToolsJson(rawValue: string): ApiAgentToolDefinition[] {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return [];
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Tools JSON must be an array（Tools JSON 必须是数组）');
  }
  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Tool #${index + 1} must be an object（工具定义必须是对象）`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.name !== 'string' || !record.name.trim()) {
      throw new Error(`Tool #${index + 1} name is required（工具名称不能为空）`);
    }
    if (typeof record.description !== 'string') {
      throw new Error(`Tool #${index + 1} description is required（工具描述不能为空）`);
    }
    return {
      name: record.name,
      description: record.description,
      inputSchema: record.inputSchema ?? {},
    };
  });
}

function resolveStatusTone(status: string | undefined): string {
  if (status === 'completed') {
    return 'bg-[#DCFCE7] text-[#166534] dark:bg-[#14532D] dark:text-[#86EFAC]';
  }
  if (status === 'needs_tool_calls') {
    return 'bg-[#FEF3C7] text-[#B45309] dark:bg-[#78350F] dark:text-[#FCD34D]';
  }
  return 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]';
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-[#E7E5E4] bg-white p-5 shadow-sm dark:border-[#292524] dark:bg-[#1C1917]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{title}</h3>
          {description ? (
            <p className="mt-1 text-sm text-[#78716C] dark:text-[#A8A29E]">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function DataMetric({
  label,
  value,
  accent = 'default',
}: {
  label: string;
  value: string;
  accent?: 'default' | 'brand' | 'warning';
}) {
  const tone = accent === 'brand'
    ? 'bg-[#FCE7D8] text-[#9A3412] dark:bg-[#7C2D12]/50 dark:text-[#FDBA74]'
    : accent === 'warning'
      ? 'bg-[#FEF3C7] text-[#92400E] dark:bg-[#78350F] dark:text-[#FCD34D]'
      : 'bg-[#F5F0ED] text-[#44403C] dark:bg-[#120F0D] dark:text-[#D6D3D1]';
  return (
    <div className="rounded-2xl border border-[#F0ECE8] bg-[#FCFBFA] p-3 dark:border-[#292524] dark:bg-[#120F0D]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">{label}</div>
      <div className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-sm font-medium ${tone}`}>{value}</div>
    </div>
  );
}

export function ApiAgentTabView() {
  const adapter = useMemo(() => new AgentSessionRtAdapter(), []);
  const providerProfiles = useMemo(
    () => [...listProviderProfiles()].sort((left, right) => {
      const leftTime = left.lastUsedAt ?? left.updatedAt;
      const rightTime = right.lastUsedAt ?? right.updatedAt;
      return rightTime.localeCompare(leftTime);
    }),
    [],
  );
  const [selectedProfileId, setSelectedProfileId] = useState(providerProfiles[0]?.profileId ?? '');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [newUserMessage, setNewUserMessage] = useState('');
  const [scopeKey, setScopeKey] = useState('');
  const [toolsJson, setToolsJson] = useState(DEFAULT_TOOLS_JSON);
  const [recentEventsPresetEnabled, setRecentEventsPresetEnabled] = useState(false);
  const [proposalToolsPresetEnabled, setProposalToolsPresetEnabled] = useState(false);
  const [historyDraft, setHistoryDraft] = useState<ApiAgentTurnItem[]>([]);
  const [sessionLookupId, setSessionLookupId] = useState('');
  const [toolResultDrafts, setToolResultDrafts] = useState<Record<string, string>>({});
  const [currentRecord, setCurrentRecord] = useState<ApiAgentSessionRecord | null>(null);
  const [lastRequestJson, setLastRequestJson] = useState('');
  const [lastResponseJson, setLastResponseJson] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedProfile = selectedProfileId ? resolveProviderProfile(selectedProfileId) : null;
  const presets = [
    ...(recentEventsPresetEnabled ? ['recent_events'] : []),
    ...(proposalToolsPresetEnabled ? ['proposal_tools'] : []),
  ];
  const toolPreview = useMemo(() => {
    try {
      return tryParseToolsJson(toolsJson);
    } catch {
      return null;
    }
  }, [toolsJson]);
  const pendingToolCalls = currentRecord?.assistantTurn.toolCalls ?? [];
  const missingPresetScopeKey = recentEventsPresetEnabled && !scopeKey.trim();

  const applyRecord = (
    record: ApiAgentSessionRecord,
    nextHistory: ApiAgentTurnItem[],
    requestPayload: Record<string, unknown>,
  ) => {
    setCurrentRecord(record);
    setHistoryDraft(nextHistory);
    setSessionLookupId(record.sessionId);
    setLastRequestJson(formatJson(requestPayload));
    setLastResponseJson(formatJson(record));
    setToolResultDrafts(
      Object.fromEntries(
        record.assistantTurn.toolCalls.map((toolCall) => [toolCall.id, '']),
      ),
    );
  };

  const submitTurn = async () => {
    if (missingPresetScopeKey) {
      setErrorMessage('recent_events 需要 Scope Key（启用 recent_events 时请先填写作用域键）');
      return;
    }
    setErrorMessage('');
    setIsSubmitting(true);
    try {
      const tools = tryParseToolsJson(toolsJson);
      const requestPayload: Record<string, unknown> = {
        ...(selectedProfile ? { providerProfile: selectedProfile } : {}),
        systemPrompt,
        tools,
        presets,
        scopeKey,
        history: historyDraft,
        newUserMessage,
      };
      const response = await adapter.runSession({
        providerProfile: selectedProfile,
        systemPrompt,
        tools,
        presets,
        scopeKey,
        history: historyDraft,
        newUserMessage,
      });
      const nextHistory = buildNextHistory(
        [
          ...historyDraft,
          ...(newUserMessage.trim()
            ? [{ role: 'user', content: newUserMessage.trim() } satisfies ApiAgentTurnItem]
            : []),
        ],
        response,
      );
      applyRecord(response, nextHistory, requestPayload);
      setNewUserMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const continueWithToolResults = async () => {
    if (!pendingToolCalls.length) {
      setErrorMessage('当前没有待续跑的 tool calls（没有待执行工具调用）');
      return;
    }
    if (missingPresetScopeKey) {
      setErrorMessage('recent_events 需要 Scope Key（启用 recent_events 时请先填写作用域键）');
      return;
    }

    setErrorMessage('');
    setIsSubmitting(true);
    try {
      const tools = tryParseToolsJson(toolsJson);
      const toolResults = pendingToolCalls.map((toolCall) => {
        const content = toolResultDrafts[toolCall.id]?.trim() ?? '';
        if (!content) {
          throw new Error(`Tool ${toolCall.name} result is required（工具结果不能为空）`);
        }
        return {
          role: 'tool' as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content,
        };
      });

      const nextRequestHistory = [...historyDraft, ...toolResults];
      const requestPayload: Record<string, unknown> = {
        ...(selectedProfile ? { providerProfile: selectedProfile } : {}),
        systemPrompt,
        tools,
        presets,
        scopeKey,
        history: nextRequestHistory,
      };
      const response = await adapter.runSession({
        providerProfile: selectedProfile,
        systemPrompt,
        tools,
        presets,
        scopeKey,
        history: nextRequestHistory,
      });
      const nextHistory = buildNextHistory(nextRequestHistory, response);
      applyRecord(response, nextHistory, requestPayload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const loadSession = async () => {
    if (!sessionLookupId.trim()) {
      setErrorMessage('请输入 sessionId（会话 ID）');
      return;
    }
    setErrorMessage('');
    setIsSubmitting(true);
    try {
      const record = await adapter.getSession(sessionLookupId.trim());
      if (!record) {
        setErrorMessage('未找到对应会话（session 不存在）');
        return;
      }
      setCurrentRecord(record);
      setLastResponseJson(formatJson(record));
      setToolResultDrafts(
        Object.fromEntries(
          record.assistantTurn.toolCalls.map((toolCall) => [toolCall.id, '']),
        ),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetDraft = () => {
    setHistoryDraft([]);
    setCurrentRecord(null);
    setToolResultDrafts({});
    setNewUserMessage('');
    setSessionLookupId('');
    setLastRequestJson('');
    setLastResponseJson('');
    setErrorMessage('');
  };

  return (
    <div className="space-y-4 pb-2" data-testid="api-agent-tab-view">
      <section className="overflow-hidden rounded-[28px] border border-[#E7E5E4] bg-white shadow-sm dark:border-[#292524] dark:bg-[#1C1917]">
        <div className="border-b border-[#F0ECE8] bg-[linear-gradient(135deg,#FCFBFA_0%,#F5F0ED_48%,#FCE7D8_100%)] px-5 py-5 dark:border-[#292524] dark:bg-[linear-gradient(135deg,rgba(28,25,23,1)_0%,rgba(24,18,15,1)_60%,rgba(124,45,18,0.35)_100%)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-3 py-1 text-xs font-medium text-[#9A3412] shadow-sm backdrop-blur dark:border-[#3F2D24] dark:bg-[#120F0D]/80 dark:text-[#FDBA74]">
                <Sparkles size={14} />
                API Agent Broker Console
              </div>
              <h2 className="mt-3 text-xl font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                在网络页里直接验证 `/agent-sessions`
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#57534E] dark:text-[#D6D3D1]">
                这不是另一套页面系统，而是网络页顶部 `API Agent` tab 的专用实验面板。
                现在可以直接验证 provider profile、tool preset、history 续跑和持久化 session 读取。
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="secondary">Issue #823</Badge>
                <Badge variant="outline">RT Broker</Badge>
                <Badge className={resolveStatusTone(currentRecord?.status)}>
                  {currentRecord?.status ?? 'idle'}
                </Badge>
              </div>
            </div>

            <div className="grid min-w-[260px] gap-3 sm:grid-cols-3 lg:w-[360px] lg:grid-cols-1 xl:grid-cols-3">
              <DataMetric
                label="Profile"
                value={selectedProfile?.name ?? 'RT default'}
                accent="brand"
              />
              <DataMetric
                label="History"
                value={`${historyDraft.length} turns`}
              />
              <DataMetric
                label="Pending"
                value={`${pendingToolCalls.length} tools`}
                accent={pendingToolCalls.length > 0 ? 'warning' : 'default'}
              />
            </div>
          </div>
        </div>
      </section>

      {errorMessage ? (
        <div
          data-testid="api-agent-error-banner"
          className="rounded-2xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C] dark:border-[#7F1D1D] dark:bg-[#3F0A0A] dark:text-[#FCA5A5]"
        >
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-4">
          <SectionCard
            title="请求编排"
            description="统一配置 Provider、Prompt、Preset 和 Tool Definitions。首版继续保持 JSON 透明度，但把层级整理成正式页面结构。"
            action={<Bot size={16} className="text-[#78716C] dark:text-[#A8A29E]" />}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="space-y-2">
                <span className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
                  Provider Profile（供应商档案）
                </span>
                <select
                  className="flex h-11 w-full rounded-2xl border border-[#E7E5E4] bg-[#FCFBFA] px-3 text-sm text-[#1C1917] outline-none transition-colors focus:border-[#C75B3A] dark:border-[#292524] dark:bg-[#120F0D] dark:text-[#FAFAF9]"
                  value={selectedProfileId}
                  onChange={(event) => setSelectedProfileId(event.target.value)}
                >
                  <option value="">RT 默认配置（Runtime default）</option>
                  {providerProfiles.map((profile) => (
                    <option key={profile.profileId} value={profile.profileId}>
                      {profile.name} / {profile.provider} / {profile.model}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
                  Scope Key（作用域键）
                </span>
                <Input
                  value={scopeKey}
                  onChange={(event) => setScopeKey(event.target.value)}
                  placeholder="例如：issue-823 / profile-alpha"
                  className="rounded-2xl"
                />
              </label>
            </div>

            <label className="space-y-2">
              <span className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
                System Prompt（系统提示词）
              </span>
              <Textarea
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={3}
                className="rounded-2xl"
                placeholder="You are ExoMind API Agent tester."
              />
            </label>

            <label className="space-y-2">
              <span className="block text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
                New User Message（新的用户消息）
              </span>
              <Textarea
                value={newUserMessage}
                onChange={(event) => setNewUserMessage(event.target.value)}
                rows={5}
                className="rounded-2xl"
                placeholder="输入本轮用户消息，点击“发送首轮 / 继续”"
              />
            </label>

            <div className="rounded-2xl border border-[#F0ECE8] bg-[#FCFBFA] p-4 dark:border-[#292524] dark:bg-[#120F0D]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
                  Presets（预置工具组）
                </span>
                <button
                  type="button"
                  onClick={() => setRecentEventsPresetEnabled((prev) => !prev)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    recentEventsPresetEnabled
                      ? 'bg-[#C75B3A] text-white'
                      : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'
                  }`}
                >
                  recent_events
                </button>
                <button
                  type="button"
                  onClick={() => setProposalToolsPresetEnabled((prev) => !prev)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    proposalToolsPresetEnabled
                      ? 'bg-[#0D9488] text-white'
                      : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'
                  }`}
                >
                  proposal_tools
                </button>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#A8A29E]">
                当前会附带 {presets.length} 个 preset。第一版先固定聚焦 `recent_events / proposal_tools`。
                {missingPresetScopeKey ? ' recent_events 已启用，发送前请先填写 Scope Key。' : ''}
              </p>
            </div>

            <div className="rounded-2xl border border-[#F0ECE8] bg-[#FCFBFA] p-4 dark:border-[#292524] dark:bg-[#120F0D]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
                  Tools JSON（工具定义 JSON）
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setToolsJson(DEFAULT_TOOLS_JSON)}
                    className="rounded-full bg-[#F5F0ED] px-3 py-1 text-[11px] font-medium text-[#57534E] dark:bg-[#292524] dark:text-[#D6D3D1]"
                  >
                    清空
                  </button>
                  <button
                    type="button"
                    onClick={() => setToolsJson(WEATHER_TOOL_JSON)}
                    className="rounded-full bg-[#DBEAFE] px-3 py-1 text-[11px] font-medium text-[#1D4ED8] dark:bg-[#1E3A8A]/40 dark:text-[#93C5FD]"
                  >
                    天气示例
                  </button>
                </div>
              </div>
              <Textarea
                value={toolsJson}
                onChange={(event) => setToolsJson(event.target.value)}
                rows={10}
                className="mt-3 rounded-2xl font-mono text-xs"
                placeholder='[{"name":"get_weather","description":"Weather lookup","inputSchema":{"type":"object"}}]'
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">
                  parsed tools: {toolPreview ? toolPreview.length : 'invalid'}
                </Badge>
                {toolPreview?.slice(0, 3).map((tool) => (
                  <Badge key={tool.name} variant="secondary">{tool.name}</Badge>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                data-testid="api-agent-run-button"
                onClick={() => {
                  void submitTurn();
                }}
                disabled={isSubmitting || missingPresetScopeKey}
                className="rounded-full bg-[#C75B3A] hover:bg-[#B45309]"
              >
                <Send className="mr-1 h-4 w-4" />
                发送首轮 / 继续
              </Button>
              <Button
                type="button"
                variant="secondary"
                data-testid="api-agent-reset-button"
                onClick={resetDraft}
                disabled={isSubmitting}
                className="rounded-full"
              >
                重置草稿
              </Button>
            </div>
          </SectionCard>

          <SectionCard
            title="轮次结果"
            description="把 broker 返回值拆成状态、正文、tool calls 和原始响应，保持可读又可追溯。"
            action={currentRecord ? <Badge className={resolveStatusTone(currentRecord.status)}>{currentRecord.status}</Badge> : null}
          >
            {currentRecord ? (
              <>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <DataMetric label="sessionId" value={currentRecord.sessionId} accent="brand" />
                  <DataMetric label="provider" value={currentRecord.provider} />
                  <DataMetric label="model" value={currentRecord.model} />
                </div>

                <div className="rounded-2xl border border-[#F0ECE8] bg-[#FCFBFA] p-4 dark:border-[#292524] dark:bg-[#120F0D]">
                  <div className="text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
                    assistantTurn.content
                  </div>
                  <pre className="exomind-selectable mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[#1C1917] dark:text-[#FAFAF9]">
                    {currentRecord.assistantTurn.content || '(empty)'}
                  </pre>
                </div>

                <div className="rounded-2xl border border-[#F0ECE8] bg-[#FCFBFA] p-4 dark:border-[#292524] dark:bg-[#120F0D]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">toolCalls</div>
                    <Badge variant="outline">{pendingToolCalls.length} pending</Badge>
                  </div>
                  <pre className="exomind-selectable mt-3 overflow-x-auto rounded-2xl bg-[#FAF7F5] p-3 text-[11px] text-[#57534E] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
                    {formatJson(currentRecord.assistantTurn.toolCalls)}
                  </pre>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-[#D6D3D1] bg-[#FCFBFA] px-4 py-8 text-center text-sm text-[#78716C] dark:border-[#44403C] dark:bg-[#120F0D] dark:text-[#A8A29E]">
                还没有返回结果。先发一轮请求，再在这里看 `sessionId / status / toolCalls`。
              </div>
            )}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard
            title="工具续跑"
            description="只在 `needs_tool_calls` 时出现待执行工具。填入 tool result 后继续调用 broker。"
            action={<Wrench size={16} className="text-[#78716C] dark:text-[#A8A29E]" />}
          >
            {pendingToolCalls.length ? (
              <>
                {pendingToolCalls.map((toolCall) => (
                  <label
                    key={toolCall.id}
                    className="block rounded-2xl border border-[#F0ECE8] bg-[#FCFBFA] p-4 dark:border-[#292524] dark:bg-[#120F0D]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{toolCall.name}</Badge>
                      <span className="exomind-selectable font-mono text-[11px] text-[#A8A29E]">{toolCall.id}</span>
                    </div>
                    <pre className="exomind-selectable mt-3 overflow-x-auto rounded-2xl bg-[#FAF7F5] p-3 text-[11px] text-[#57534E] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
                      {formatJson(toolCall.input)}
                    </pre>
                    <Textarea
                      value={toolResultDrafts[toolCall.id] ?? ''}
                      onChange={(event) => setToolResultDrafts((prev) => ({
                        ...prev,
                        [toolCall.id]: event.target.value,
                      }))}
                      rows={4}
                      className="mt-3 rounded-2xl"
                      placeholder="输入该工具的结果文本，续跑时会转成 tool history。"
                    />
                  </label>
                ))}

                <Button
                  type="button"
                  variant="secondary"
                  data-testid="api-agent-continue-tools-button"
                  onClick={() => {
                    void continueWithToolResults();
                  }}
                  disabled={isSubmitting || missingPresetScopeKey}
                  className="rounded-full"
                >
                  继续执行 Tool Results
                </Button>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-[#D6D3D1] bg-[#FCFBFA] px-4 py-6 text-sm text-[#78716C] dark:border-[#44403C] dark:bg-[#120F0D] dark:text-[#A8A29E]">
                当前没有待填的 tool calls。
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="会话读取"
            description="从 `/agent-sessions/:id` 回读持久化记录，验证前端与 RT 落库结果一致。"
            action={<RefreshCw size={16} className="text-[#78716C] dark:text-[#A8A29E]" />}
          >
            <div className="flex gap-2">
              <Input
                value={sessionLookupId}
                onChange={(event) => setSessionLookupId(event.target.value)}
                placeholder="输入 sessionId"
                className="rounded-2xl"
              />
              <Button
                type="button"
                variant="outline"
                data-testid="api-agent-load-session-button"
                onClick={() => {
                  void loadSession();
                }}
                disabled={isSubmitting}
                className="rounded-full"
              >
                <RefreshCw className="mr-1 h-4 w-4" />
                读取
              </Button>
            </div>
          </SectionCard>

          <SectionCard
            title="调试证据"
            description="把前端当前拼装的 history、最后一次请求和响应都留在页面内，方便对照排查。"
          >
            <div className="space-y-3">
              <div className="rounded-2xl border border-[#F0ECE8] bg-[#FCFBFA] p-4 dark:border-[#292524] dark:bg-[#120F0D]">
                <div className="text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">history draft</div>
                <pre className="exomind-selectable mt-3 overflow-x-auto rounded-2xl bg-[#FAF7F5] p-3 text-[11px] text-[#57534E] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
                  {formatJson(historyDraft)}
                </pre>
              </div>

              <div className="rounded-2xl border border-[#F0ECE8] bg-[#FCFBFA] p-4 dark:border-[#292524] dark:bg-[#120F0D]">
                <div className="text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">last request</div>
                <pre className="exomind-selectable mt-3 overflow-x-auto rounded-2xl bg-[#FAF7F5] p-3 text-[11px] text-[#57534E] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
                  {lastRequestJson || '(empty)'}
                </pre>
              </div>

              <div className="rounded-2xl border border-[#F0ECE8] bg-[#FCFBFA] p-4 dark:border-[#292524] dark:bg-[#120F0D]">
                <div className="text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">last response</div>
                <pre className="exomind-selectable mt-3 overflow-x-auto rounded-2xl bg-[#FAF7F5] p-3 text-[11px] text-[#57534E] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
                  {lastResponseJson || '(empty)'}
                </pre>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
