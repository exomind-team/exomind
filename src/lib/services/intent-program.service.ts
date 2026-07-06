import { IntentProgramWebStorageAdapter } from '@/lib/adapters/intent-program-web-storage';
import { getEventLogService, type EventLogService } from '@/lib/services/eventlog.service';
import type { Event } from '@/lib/types/event';
import type {
  IntentProgram,
  IntentProgramAuditEvent,
  IntentProgramMetrics,
  IntentProgramRunRecord,
  IntentProgramStorage,
  RecertifyIntentProgramInput,
} from '@/lib/types/intent-program';

const INTENT_PROGRAM_TAG = 'intent_program';

export interface RunIntentProgramResult {
  program: IntentProgram;
  record: IntentProgramRunRecord;
}

interface IntentProgramServiceOptions {
  storage?: IntentProgramStorage;
  eventLog?: EventLogService;
  now?: () => string;
  idFactory?: () => string;
}

export interface IntentProgramService {
  listPrograms(): Promise<IntentProgram[]>;
  getProgram(programId: string): Promise<IntentProgram | null>;
  listSovereigntyEvents(limit?: number): Promise<IntentProgramAuditEvent[]>;
  runProgram(programId: string): Promise<RunIntentProgramResult>;
  acceptRun(programId: string, runId: string, note: string): Promise<IntentProgram>;
  overrideRun(programId: string, runId: string, note: string): Promise<IntentProgram>;
  recertifyProgram(programId: string, input: RecertifyIntentProgramInput): Promise<IntentProgram>;
  pauseProgram(programId: string, note: string): Promise<IntentProgram>;
  retireProgram(programId: string, note: string): Promise<IntentProgram>;
  calculateMetrics(programs: IntentProgram[]): IntentProgramMetrics;
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(iso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function clonePrograms(programs: IntentProgram[]): IntentProgram[] {
  return structuredClone(programs);
}

function intentProgramTags(extra: string): Set<string> {
  return new Set([INTENT_PROGRAM_TAG, extra]);
}

function createProgram(input: Omit<IntentProgram, 'runs'>): IntentProgram {
  return {
    ...input,
    runs: [],
  };
}

export function createSeedIntentPrograms(nowIso: string): IntentProgram[] {
  const next30 = addDaysIso(nowIso, 30);
  const next14 = addDaysIso(nowIso, 14);
  return [
    createProgram({
      id: 'research-to-note',
      title: '技术调研整理为 Markdown',
      author: 'HailayLin',
      authoredAt: nowIso,
      state: 'delegated',
      lane: 'B',
      intent: '把一组网页、论文或 issue 证据整理为可复核的 Markdown 笔记，而不是让 Agent 直接替我得出研究结论。',
      trigger: '用户把调研材料放入收件箱并选择“生成调研笔记”时触发。',
      inputs: ['用户选择的网页链接', '本地 Markdown 摘要', 'EventLog 中的原始摘录'],
      executors: ['Claude Code / Codex 执行核', 'Markdown formatter'],
      forbidden: ['不得把 Agent 推断写成已验证结论', '不得省略来源', '不得替用户做“是否值得采用”的价值裁决'],
      guardrails: [
        { id: 'source-required', label: '来源字段必填', kind: 'input_scope', enforced: true },
        { id: 'truth-review', label: '写入事实层前必须验收', kind: 'truth_write', enforced: true },
        { id: 'executor-allowlist', label: '只允许调研与格式化执行器', kind: 'tool_allowlist', enforced: true },
      ],
      verification: ['每条关键 claim 必须有 source', '输出中标注 claim/method/source/verdict/confidence', '用户能指出至少一条不确定结论'],
      sourcePolicy: '亲历实测 > 一手原始记录 > 官方/权威源 > 二手转述 > Agent 推断。',
      humanGate: {
        requiredWhen: ['需要采纳技术路线', '需要写入事实 EventLog', '来源低于官方/权威源'],
        reason: '调研属于低锚点高价值判断，Agent 只能整理证据，不能替人裁决。',
      },
      output: '带证据链的 Markdown 笔记草稿',
      truthPolicy: '机器输出只能作为派生记录；人工验收后才可写入 EventLog canonical 事实层。',
      overridePolicy: '用户可接受、覆写、暂停或打回重新著作，覆写必须记录原因。',
      logPolicy: '每次运行记录输入、执行器、来源策略、机器输出、人工裁决与差异。',
      recertification: {
        cadenceDays: 30,
        nextReviewAt: next30,
      },
    }),
    createProgram({
      id: 'discussion-to-tasks',
      title: '项目讨论拆解为任务',
      author: 'HailayLin',
      authoredAt: nowIso,
      state: 'delegated',
      lane: 'B',
      intent: '把讨论材料整理成可执行任务，但保留人对优先级和承诺的最终调度权。',
      trigger: '会议记录或聊天摘要进入缓冲区时触发。',
      inputs: ['会议记录', '聊天摘录', '现有任务列表'],
      executors: ['Task parser', 'Codex 执行核'],
      forbidden: ['不得自行承诺截止日期', '不得自动改动长期目标', '不得把建议直接标记为已承诺'],
      guardrails: [
        { id: 'task-output-only', label: '只输出任务草案', kind: 'output_scope', enforced: true },
        { id: 'commitment-gate', label: '承诺必须人工确认', kind: 'human_gate', enforced: true },
      ],
      verification: ['每个任务能追溯到原句', '每个任务含验收标准', '高利害任务进入 B 道等待裁决'],
      sourcePolicy: '优先使用一手会议记录和聊天原文，Agent 总结只作为待验证 claim。',
      humanGate: {
        requiredWhen: ['任务会改变对外承诺', '任务影响本周 WIP 上限', '任务进入长期目标'],
        reason: '任务拆解可以自动化，承诺与优先级不能自动化。',
      },
      output: '任务草案列表',
      truthPolicy: '任务草案不是事实；人工确认后才成为任务库中的承诺。',
      overridePolicy: '用户可以合并、删除、改写任务，原草案保留在运行记录。',
      logPolicy: '记录讨论来源、拆解结果、人工调整和最终采纳任务。',
      recertification: {
        cadenceDays: 30,
        nextReviewAt: next30,
      },
    }),
    createProgram({
      id: 'code-review-gate',
      title: 'Agent 代码修改验收闸门',
      author: 'HailayLin',
      authoredAt: nowIso,
      state: 'awaiting_review',
      lane: 'B',
      intent: '把 Agent 代码输出转成 claim/method/source/verdict 的验收对象，防止“测试变绿即事实成立”。',
      trigger: 'Agent 完成代码改动并准备提交时触发。',
      inputs: ['git diff', '测试输出', '关联 issue / 需求'],
      executors: ['Vitest', 'TypeScript compiler', 'Codex review agent'],
      forbidden: ['不得跳过红灯测试', '不得直接提交不可解释 diff', '不得把 Agent 自评当作验收'],
      guardrails: [
        { id: 'test-command-required', label: '测试命令必填', kind: 'input_scope', enforced: true },
        { id: 'human-before-commit', label: '提交前强制人核闸门', kind: 'human_gate', enforced: true },
        { id: 'allowed-tools', label: '只允许测试、编译、审查执行器', kind: 'tool_allowlist', enforced: true },
      ],
      verification: ['每个行为变更有测试', '测试曾经失败再通过', 'diff 能解释为何满足需求', 'claim/method/source/verdict/confidence 完整'],
      sourcePolicy: '动态运行捕获 > 静态分析 > 文档 > 社区逆向 > LLM 推断。',
      humanGate: {
        requiredWhen: ['代码修改准备进入主干', '测试覆盖不足', '涉及数据写入或同步'],
        reason: '代码域可让机器验证“对”，但“值得合并”仍由人裁决。',
      },
      output: '带验收证据的提交候选',
      truthPolicy: 'EventLog 记录验收证据；git commit 只在人工接受后发生。',
      overridePolicy: '用户可接受、要求修改、暂停或退役本卡，覆写必须说明测试/需求缺口。',
      logPolicy: '记录 diff 摘要、测试命令、审查结论、人工裁决。',
      recertification: {
        cadenceDays: 30,
        nextReviewAt: next30,
      },
    }),
    createProgram({
      id: 'idea-to-outline',
      title: '碎片想法整理为文章提纲',
      author: 'HailayLin',
      authoredAt: nowIso,
      state: 'delegated',
      lane: 'A',
      intent: '把碎片笔记收束成可继续著作的提纲，但不替用户写最终立场。',
      trigger: '用户选择三条以上碎片想法并点击“整理提纲”。',
      inputs: ['碎片想法', '相关 EventLog', '用户指定主题'],
      executors: ['Outline generator'],
      forbidden: ['不得替用户下最终判断', '不得把提纲发布到外部渠道'],
      guardrails: [
        { id: 'local-output', label: '输出限定为本地草稿', kind: 'output_scope', enforced: true },
        { id: 'no-external-send', label: '禁止对外发送', kind: 'human_gate', enforced: true },
      ],
      verification: ['提纲保留原始想法锚点', '区分事实、推断和问题', '用户能删除任意段落而不破坏事实源'],
      sourcePolicy: '优先使用用户亲手记录的一手碎片。',
      humanGate: {
        requiredWhen: ['需要发表', '需要形成价值判断', '需要写入长期信念'],
        reason: '提纲是执行加速，立场与发表属于人核慢时钟。',
      },
      output: '文章提纲草稿',
      truthPolicy: '提纲是派生草稿，不改变 EventLog 事实。',
      overridePolicy: '用户可直接改写提纲，系统保留机器原稿用于对账。',
      logPolicy: '记录输入碎片、生成提纲和人工改写。',
      recertification: {
        cadenceDays: 14,
        nextReviewAt: next14,
      },
    }),
    createProgram({
      id: 'learning-to-review-card',
      title: '学习过程整理成复习卡',
      author: 'HailayLin',
      authoredAt: nowIso,
      state: 'needs_reauthoring',
      lane: 'B',
      intent: '把学习记录转成复习卡，同时检查我是否真的内化，而不是让 Agent 维护答案。',
      trigger: '学习时间块结束并产生笔记时触发。',
      inputs: ['学习笔记', '时间块反馈', '用户手写问题'],
      executors: ['Review card drafter'],
      forbidden: ['不得直接替用户写答案并标记掌握', '不得把价值信念当事实卡维护'],
      guardrails: [
        { id: 'question-not-answer', label: '维护提问而非答案', kind: 'output_scope', enforced: true },
        { id: 'mastery-recert', label: '掌控失败阻断自动运行', kind: 'truth_write', enforced: true },
      ],
      verification: ['卡片必须能逼用户取回', '至少一张卡要求解释而非背诵', '用户能说明为何这样复习'],
      sourcePolicy: '用户亲手学习记录优先，Agent 扩展资料只作为补视野。',
      humanGate: {
        requiredWhen: ['涉及信念或价值', '用户无法解释卡片为何这样问', '卡片准备进入长期复习牌组'],
        reason: '第三权维护的是提问，不是过去答案。',
      },
      output: '复习卡草稿与再认证问题',
      truthPolicy: '卡片进入牌组前必须由用户确认其仍服务当前理解。',
      overridePolicy: '用户可删除、改问法、降级为待重新著作。',
      logPolicy: '记录学习来源、卡片草稿、用户改写和掌控判定。',
      recertification: {
        cadenceDays: 14,
        nextReviewAt: next14,
        lastVerdict: 'fail',
        lastNote: '示例卡：故意处于待重新著作，展示第三权会阻断自动化。',
      },
    }),
  ];
}

export class IntentProgramServiceImpl implements IntentProgramService {
  private readonly storage: IntentProgramStorage;
  private readonly eventLog: EventLogService;
  private readonly now: () => string;
  private readonly idFactory: () => string;

  constructor(options: IntentProgramServiceOptions = {}) {
    this.storage = options.storage ?? new IntentProgramWebStorageAdapter();
    this.eventLog = options.eventLog ?? getEventLogService();
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  async listPrograms(): Promise<IntentProgram[]> {
    const stored = await this.storage.read();
    if (stored && stored.length > 0) {
      const { programs: refreshed, expired } = this.refreshExpiredPrograms(stored);
      if (JSON.stringify(refreshed) !== JSON.stringify(stored)) {
        await Promise.all(expired.map((program) => this.eventLog.addEvent(
          `委托到期：${program.title}\n下一状态：expired\n再认证日期：${program.recertification.nextReviewAt}`,
          intentProgramTags('intent_expired'),
        )));
        await this.storage.write(refreshed);
      }
      return clonePrograms(refreshed);
    }

    const seeded = createSeedIntentPrograms(this.now());
    await this.storage.write(seeded);
    return clonePrograms(seeded);
  }

  async getProgram(programId: string): Promise<IntentProgram | null> {
    const programs = await this.listPrograms();
    return programs.find((program) => program.id === programId) ?? null;
  }

  async listSovereigntyEvents(limit = 8): Promise<IntentProgramAuditEvent[]> {
    const events = await this.eventLog.loadEvents();
    return events
      .filter((event) => event.tags.has(INTENT_PROGRAM_TAG))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .map((event) => this.toAuditEvent(event));
  }

  async runProgram(programId: string): Promise<RunIntentProgramResult> {
    const programs = await this.listPrograms();
    const program = this.requireProgram(programs, programId);
    if (this.isRunAuthorityBlocked(program)) {
      throw new Error(`意图程序 ${program.title} 当前状态为 ${program.state}，不能自动运行`);
    }

    const record: IntentProgramRunRecord = {
      id: this.idFactory(),
      programId,
      startedAt: this.now(),
      state: 'awaiting_review',
      inputSnapshot: program.inputs.join('；'),
      executorSnapshot: [...program.executors],
      machineOutput: this.createMachineOutput(program),
      verificationSnapshot: `claim/method/source/verdict/confidence: ${program.verification.join('；')}`,
    };

    const updated: IntentProgram = {
      ...program,
      state: program.humanGate.requiredWhen.length > 0 ? 'awaiting_review' : 'accepted',
      runs: [record, ...program.runs],
    };

    await this.saveProgram(programs, updated);
    await this.eventLog.addEvent(
      `试运行意图程序：${updated.title}\n状态：${updated.state}\n人核闸门：${updated.humanGate.reason}`,
      intentProgramTags('intent_run'),
    );

    return { program: updated, record };
  }

  async acceptRun(programId: string, runId: string, note: string): Promise<IntentProgram> {
    return this.decideRun(programId, runId, {
      state: 'accepted',
      note,
      eventTitle: '人工接受意图程序',
    });
  }

  async overrideRun(programId: string, runId: string, note: string): Promise<IntentProgram> {
    return this.decideRun(programId, runId, {
      state: 'overridden',
      note,
      eventTitle: '人工覆写意图程序',
    });
  }

  async recertifyProgram(programId: string, input: RecertifyIntentProgramInput): Promise<IntentProgram> {
    const programs = await this.listPrograms();
    const program = this.requireProgram(programs, programId);
    if (this.hasPendingHumanReview(program)) {
      throw new Error(`意图程序 ${program.title} 需要先裁决当前执行记录，不能用再认证绕过人核`);
    }
    if (program.state === 'draft' || program.state === 'authored' || program.state === 'retired') {
      throw new Error(`意图程序 ${program.title} 当前状态为 ${program.state}，不能再认证`);
    }
    const nextState = input.verdict === 'pass'
      ? 'delegated'
      : input.verdict === 'partial'
        ? 'paused'
        : 'needs_reauthoring';

    const updated: IntentProgram = {
      ...program,
      state: nextState,
      recertification: {
        ...program.recertification,
        lastReviewedAt: this.now(),
        lastVerdict: input.verdict,
        lastNote: input.note,
        nextReviewAt: addDaysIso(this.now(), program.recertification.cadenceDays),
      },
    };

    await this.saveProgram(programs, updated);
    const eventTitle = input.verdict === 'fail' ? '再认证失败' : '再认证完成';
    await this.eventLog.addEvent(
      `${eventTitle}：${updated.title}\n判定：${input.verdict}\n说明：${input.note}\n下一状态：${updated.state}`,
      intentProgramTags('intent_recertification'),
    );

    return updated;
  }

  async pauseProgram(programId: string, note: string): Promise<IntentProgram> {
    return this.setProgramState(programId, 'paused', `暂停意图程序：${note}`);
  }

  async retireProgram(programId: string, note: string): Promise<IntentProgram> {
    return this.setProgramState(programId, 'retired', `退役意图程序：${note}`);
  }

  calculateMetrics(programs: IntentProgram[]): IntentProgramMetrics {
    const total = programs.length;
    const delegated = programs.filter((program) => program.state === 'delegated' || program.state === 'accepted').length;
    const awaitingHumanReview = programs.filter((program) => program.state === 'awaiting_review').length;
    const needsReauthoring = programs.filter((program) => program.state === 'needs_reauthoring').length;
    const averageSovereigntyScore = total === 0
      ? 0
      : Math.round(programs.reduce((sum, program) => sum + this.calculateSovereigntyScore(program), 0) / total);

    return {
      total,
      delegated,
      awaitingHumanReview,
      needsReauthoring,
      averageSovereigntyScore,
    };
  }

  private async decideRun(
    programId: string,
    runId: string,
    decision: { state: 'accepted' | 'overridden'; note: string; eventTitle: string },
  ): Promise<IntentProgram> {
    const programs = await this.listPrograms();
    const program = this.requireProgram(programs, programId);
    const run = program.runs.find((record) => record.id === runId);
    if (!run) {
      throw new Error(`找不到执行记录：${runId}`);
    }
    const latestRun = program.runs[0];
    if (program.state !== 'awaiting_review' || run.state !== 'awaiting_review' || latestRun?.id !== runId) {
      throw new Error(`执行记录 ${runId} 不再等待人核验收`);
    }

    const updatedRun: IntentProgramRunRecord = {
      ...run,
      state: decision.state,
      completedAt: this.now(),
      decisionNote: decision.note,
      humanOutput: decision.state === 'overridden'
        ? `${run.machineOutput}\n\n[人工覆写 / Human override]\n${decision.note}`
        : run.machineOutput,
    };

    const updated: IntentProgram = {
      ...program,
      state: decision.state,
      runs: [updatedRun, ...program.runs.filter((record) => record.id !== runId)],
    };

    await this.saveProgram(programs, updated);
    await this.eventLog.addEvent(
      `${decision.eventTitle}：${updated.title}\n裁决：${decision.note}\n原输出：${run.machineOutput}`,
      intentProgramTags(decision.state === 'accepted' ? 'intent_accept' : 'intent_override'),
    );

    return updated;
  }

  private async setProgramState(
    programId: string,
    state: IntentProgram['state'],
    note: string,
  ): Promise<IntentProgram> {
    const programs = await this.listPrograms();
    const program = this.requireProgram(programs, programId);
    const updated = { ...program, state };
    await this.saveProgram(programs, updated);
    await this.eventLog.addEvent(`${note}\n下一状态：${state}`, intentProgramTags('intent_state'));
    return updated;
  }

  private requireProgram(programs: IntentProgram[], programId: string): IntentProgram {
    const program = programs.find((item) => item.id === programId);
    if (!program) {
      throw new Error(`找不到意图程序：${programId}`);
    }
    return program;
  }

  private async saveProgram(programs: IntentProgram[], updated: IntentProgram): Promise<void> {
    const next = programs.map((program) => (program.id === updated.id ? updated : program));
    await this.storage.write(next);
  }

  private createMachineOutput(program: IntentProgram): string {
    return [
      `意图：${program.intent}`,
      `输出：${program.output}`,
      `验证：${program.verification[0] ?? '等待人工补充验证标准'}`,
      `闸门：${program.humanGate.requiredWhen.join('；')}`,
    ].join('\n');
  }

  private isRunAuthorityBlocked(program: IntentProgram): boolean {
    return program.state === 'draft'
      || program.state === 'authored'
      || program.state === 'running'
      || program.state === 'awaiting_review'
      || program.state === 'overridden'
      || program.state === 'paused'
      || program.state === 'expired'
      || program.state === 'needs_reauthoring'
      || program.state === 'retired';
  }

  private hasPendingHumanReview(program: IntentProgram): boolean {
    return program.state === 'running'
      || program.state === 'awaiting_review'
      || program.runs.some((run) => run.state === 'running' || run.state === 'awaiting_review');
  }

  private toAuditEvent(event: Event): IntentProgramAuditEvent {
    return {
      id: event.id,
      timestamp: event.timestamp,
      content: event.content,
      tags: Array.from(event.tags),
    };
  }

  private calculateSovereigntyScore(program: IntentProgram): number {
    const requiredFields = [
      program.intent,
      program.trigger,
      program.sourcePolicy,
      program.truthPolicy,
      program.overridePolicy,
      program.logPolicy,
    ];
    const fieldScore = requiredFields.filter(Boolean).length * 10;
    const guardrailScore = Math.min(20, program.guardrails.filter((guardrail) => guardrail.enforced).length * 7);
    const verificationScore = Math.min(20, program.verification.length * 5);
    const recertificationScore = program.recertification.cadenceDays > 0 ? 20 : 0;
    const statePenalty = program.state === 'needs_reauthoring' ? 10 : 0;
    return Math.max(0, Math.min(100, fieldScore + guardrailScore + verificationScore + recertificationScore - statePenalty));
  }

  private refreshExpiredPrograms(programs: IntentProgram[]): { programs: IntentProgram[]; expired: IntentProgram[] } {
    const nowTime = Date.parse(this.now());
    if (Number.isNaN(nowTime)) {
      return { programs, expired: [] };
    }

    const expired: IntentProgram[] = [];
    const refreshed = programs.map((program) => {
      const reviewTime = Date.parse(program.recertification.nextReviewAt);
      const canExpire = program.state === 'delegated' || program.state === 'accepted';
      if (!canExpire || Number.isNaN(reviewTime) || reviewTime > nowTime) {
        return program;
      }
      const updated: IntentProgram = {
        ...program,
        state: 'expired',
      };
      expired.push(updated);
      return updated;
    });

    return { programs: refreshed, expired };
  }
}

let intentProgramServiceInstance: IntentProgramService | null = null;

export function getIntentProgramService(): IntentProgramService {
  if (!intentProgramServiceInstance) {
    intentProgramServiceInstance = new IntentProgramServiceImpl();
  }
  return intentProgramServiceInstance;
}
