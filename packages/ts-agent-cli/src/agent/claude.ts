import { spawn } from "node:child_process";
import {
    JsonData,
    unixTimeNow,
    USD_RMB_RATIO,
    JsonDataWithPath,
    isWindows,
} from "../util";
import { waitProcess } from "../util/os";

// ============ Claude Event ============
/**
 * Claude 事件类型
 */

export interface ClaudeEventData {
    type?: string;
    subtype?: string;
    [key: string]: unknown;
}
/**
 * Claude 事件
 *
 * 处理 Claude CLI 的 JSON 输出事件
 */

export class ClaudeEvent {
    data: ClaudeEventData;

    constructor(data: ClaudeEventData | string) {
        if (typeof data === "string") {
            try {
                this.data = JSON.parse(data);
            } catch {
                // 解析失败，以原始形式保存
                this.data = {
                    type: "raw",
                    raw: data,
                };
            }
        } else {
            this.data = data;
        }
    }

    /** 事件类型 */
    get type(): string | undefined {
        return this.data.type;
    }

    /** 原始字符串（仅对解析失败的数据有效） */
    get rawStr(): string | undefined {
        if (this.type === "raw") {
            return this.data.raw as string | undefined;
        }
        return undefined;
    }

    /** 返回的信息 */
    get result(): string | undefined {
        if (this.type === "result" && typeof this.data.result === "string") {
            return this.data.result;
        }
        return undefined;
    }

    /** 子类型 */
    get subType(): string | undefined {
        return this.data.subtype;
    }

    /** 状态 */
    get status(): string | undefined {
        return this.data?.status?.toString();
    }

    /** 会话 ID */
    get sessionId(): string | undefined {
        return this.data.session_id as string | undefined;
    }

    /** 是否为压缩边界 */
    get isCompactBoundary(): boolean {
        // [SYSTEM] {'type': 'system', 'subtype': 'status', 'status': 'compacting', 'session_id': 'f435c34c-d846-47f5-bd72-b36c2c369d5c', 'uuid': 'ab200bad-9b3e-4aa0-a099-32c1a32d182d'}
        // [SYSTEM] {'type': 'system', 'subtype': 'status', 'status': None, 'session_id': 'f435c34c-d846-47f5-bd72-b36c2c369d5c', 'uuid': '6d4f5092-8037-42b3-9ce5-5c221c8edcbe'}
        // [SYSTEM] {'type': 'system', 'subtype': 'compact_boundary', 'session_id': 'f435c34c-d846-47f5-bd72-b36c2c369d5c', 'uuid': 'd81cae6a-b864-4bff-9c9b-bd81b5a54318', 'compact_metadata': {'trigger': 'auto', 'pre_tokens': 155541}}
        return this.type === "system" && this.subType === "compact_boundary";
    }

    /** 获取数据 */
    get(key: string, defaultValue?: unknown): unknown {
        return this.data[key] ?? defaultValue;
    }

    /**
     * 尝试从各种输入创建实例
     */
    static tryFrom(
        e: ClaudeEvent | ClaudeEventData | string,
    ): ClaudeEvent | null {
        if (e instanceof ClaudeEvent) {
            return e;
        }
        try {
            return new ClaudeEvent(e);
        } catch {
            return null;
        }
    }

    /**
     * 静态展示方法
     */
    static show(
        e: ClaudeEvent | ClaudeEventData | string,
        timestamp?: number,
    ): string {
        if (e instanceof ClaudeEvent) {
            return e.render(timestamp);
        }
        try {
            return new ClaudeEvent(e).render();
        } catch {
            return `[PARSE_ERROR] ${e}`;
        }
    }

    /**
     * 展开嵌套消息（不跟踪父消息）
     */
    *flatten(): Generator<ClaudeEvent> {
        for (const [e, _] of this.flattenWithParent()) {
            yield e;
        }
    }

    /**
     * 展开嵌套消息（跟踪父消息）
     *
     * @param parent - 父事件
     */
    *flattenWithParent(
        parent?: ClaudeEvent,
    ): Generator<[ClaudeEvent, ClaudeEvent | undefined]> {
        switch (this.type) {
            case "user":
            case "assistant": {
                // 在 event.message.content 里
                const blockMessages = this.get("message");
                if (!blockMessages || typeof blockMessages !== "object") {
                    yield [this, parent];
                    return;
                }
                const messageContent = (
                    blockMessages as Record<string, unknown>
                ).content;
                if (!messageContent || !Array.isArray(messageContent)) {
                    yield [this, parent];
                    return;
                }
                for (const block of messageContent) {
                    const blockEvent = ClaudeEvent.tryFrom(
                        block as ClaudeEventData,
                    );
                    if (blockEvent) {
                        yield* blockEvent.flattenWithParent(this);
                    }
                }
                return;
            }
            default:
                yield [this, parent];
        }
    }

    /**
     * 静态展开方法
     */
    static *flat(source: Iterable<ClaudeEvent>): Generator<ClaudeEvent> {
        for (const e of source) {
            yield* e.flatten();
        }
    }

    /**
     * 静态展开方法（带父消息）
     */
    static *flatWithParent(
        source: Iterable<ClaudeEvent>,
        parent?: ClaudeEvent,
    ): Generator<[ClaudeEvent, ClaudeEvent | undefined]> {
        for (const e of source) {
            yield* e.flattenWithParent(parent);
        }
    }

    /**
     * 渲染为字符串
     * @alias show
     */
    render(timestamp?: number): string {
        const evt = this.data;
        const t = this.type;
        const subT = this.subType;
        const tag = (t || "UNKNOWN").toUpperCase();

        const head = timestamp
            ? `[${tag} ${new Date(timestamp).toISOString().slice(0, 19).replace("T", " ")}] `
            : `[${tag}] `;

        switch (t) {
            case "system": {
                switch (subT) {
                    case "init":
                        return (
                            head +
                            `session=${evt.session_id} cwd=${evt.cwd} model=${evt.model} tools=${(evt?.tools as any[])?.length ?? 0}`
                        );
                    case "status":
                        return (
                            head +
                            `status=${evt.status} session=${evt.session_id}`
                        );
                }
                break;
            }
            case "assistant": {
                const msg = (evt.message as Record<string, unknown>) || {};
                const blocks = (msg.content as unknown[]) || [];
                return blocks
                    .map((block) => ClaudeEvent.show(block as ClaudeEventData))
                    .join("\n")
                    .trim();
            }
            case "user": {
                if (
                    evt.message &&
                    (evt.message as Record<string, unknown>).content
                ) {
                    const blocks =
                        ((evt.message as Record<string, unknown>)
                            .content as unknown[]) || [];
                    return blocks
                        .map((block) =>
                            ClaudeEvent.show(block as ClaudeEventData),
                        )
                        .join("\n")
                        .trim();
                }
                break;
            }
            case "thinking":
                return head + `${evt.thinking ?? ""}`;
            case "text":
                return head + `${evt.text}`;
            case "tool_use": {
                const name = evt.name as string;
                const tid = evt.id as string;
                let msg = head + `${name} id=${tid}`;

                const input = evt.input as Record<string, unknown> | undefined;
                if (input) {
                    const description = input.description as string | undefined;
                    const command = input.command as string | undefined;
                    const timeout = input.timeout as string | undefined;
                    if (description) msg += `\n\t${description}`;
                    if (command) msg += `\n\t${command}`;
                    if (timeout) msg += `\n\ttimeout=${timeout}`;
                }
                return msg;
            }
            case "tool_result": {
                let msg = `[${tag}]`;
                const name = evt.name as string | undefined;
                const tid = evt.tool_use_id as string | undefined;
                if (name) msg += ` name=${name}`;
                if (tid) msg += ` id=${tid}`;
                if (evt.is_error) msg += " ERROR";
                const content = evt.content as string | undefined;
                if (content) msg += ` ${content}`;
                return msg;
            }
            case "result": {
                const so = evt.structured_output;
                const cost = evt.total_cost_usd as number | undefined;
                const result = evt.result as string | undefined;
                const numTurns = (evt.num_turns as number) || 0;

                let msg =
                    head +
                    `cost=${cost} structured=${so} turns=${numTurns} ${result}`;
                if (evt.error) msg += " error!";
                const usage = evt.usage as Record<string, unknown> | undefined;
                if (usage) msg += `\n\tusage=${JSON.stringify(usage)}`;
                const modelUsage = evt.modelUsage as
                    | Record<string, unknown>
                    | undefined;
                if (modelUsage)
                    msg += `\n\tmodelUsage=${JSON.stringify(modelUsage)}`;
                if (subT === "error_during_execution") {
                    const errors = evt.errors as unknown[] | undefined;
                    msg += `\n\terror=${JSON.stringify(errors)}`;
                }
                return msg;
            }
        }

        return head + `${JSON.stringify(evt)}`;
    }
}
// ============ Claude Usage ============
/**
 * Claude 使用情况统计
 */

export class ClaudeUsage {
    /** 该结果是否为错误结果 */
    isError = false;

    /** 对话总时间（毫秒） */
    durationMs = 0;

    /** 对话被外部 API 占用的时间（毫秒） */
    durationApiMs = 0;

    /** 会话 ID */
    sessionId: string | null = null;

    /** 总消耗金额（美元） */
    totalCostUsd = 0;

    /** 权限被拒绝的次数 */
    nPermissionDenials = 0;

    /** 输入 token 数 */
    inputTokens = 0;

    /** 缓存创建输入 token 数 */
    cacheCreationInputTokens = 0;

    /** 缓存读取输入 token 数 */
    cacheReadInputTokens = 0;

    /** 输出 token 数 */
    outputTokens = 0;

    /** Web 搜索请求数 */
    webSearchRequests = 0;

    /** Web 抓取请求数 */
    webFetchRequests = 0;

    /** 服务层级 */
    serviceTier = "standard";

    /** 短暂缓存（1小时）输入 token 数 */
    ephemeral1hInputTokens = 0;

    /** 短暂缓存（5分钟）输入 token 数 */
    ephemeral5mInputTokens = 0;

    /** 对话总时间（秒） */
    get durationS(): number {
        return this.durationMs / 1000;
    }

    /** 对话 API 交互时间（秒） */
    get durationApiS(): number {
        return this.durationApiMs / 1000;
    }

    /**
     * 从 result 事件数据创建
     * @example 参考：{
         "type": "result",
         "subtype": "success",
         "is_error": False,
         "duration_ms": 1154158,
         "duration_api_ms": 193946,
         "num_turns": 13,
         "result": "状态：等待中\n操作：继续轮询\n问题：无\n建议：保持等待\n\n---\n\n等待中（轮询周期10秒）...",
         "session_id": "fed3e401-830e-4833-b013-f035ec1976f6",
         "total_cost_usd": 0.9260158000000001,
         "usage": {
             "input_tokens": 7754,
             "cache_creation_input_tokens": 95480,
             "cache_read_input_tokens": 373269,
             "output_tokens": 2192,
             "server_tool_use": {...},
             "service_tier": "standard",
             "cache_creation": {...},
         },
         "modelUsage": {
             "claude-opus-4-5-20251101": {...},
             "claude-haiku-4-5-20251001": {...},
         },
         "permission_denials": [],
         "uuid": "591c5ece-ce35-41c4-a820-cd22faf76bcd",
     }
     */
    static fromResult(result: Record<string, unknown>): ClaudeUsage {
        const usage = new ClaudeUsage();

        const usageData = result.usage as Record<string, unknown> | undefined;
        if (!usageData) {
            return usage;
        }

        // 直接迁移属性
        for (const key of Object.keys(usage)) {
            const snakeKey = key.replace(
                /[A-Z]/g,
                (m) => `_${m.toLowerCase()}`,
            );
            if (!(snakeKey in result)) continue;

            const original = (usage as Record<string, any>)[key];
            const resultValue = result[snakeKey];
            if (
                typeof original === null ||
                typeof original !== typeof resultValue
            )
                console.warn(
                    "警告：usage值类型发生变化",
                    key,
                    original,
                    resultValue,
                );
            (usage as Record<string, any>)[key] = resultValue;
        }

        // server_tool_use
        const serverToolUse = usageData.server_tool_use as
            | Record<string, unknown>
            | undefined;
        if (serverToolUse) {
            usage.webSearchRequests =
                (serverToolUse.web_search_requests as number) || 0;
            usage.webFetchRequests =
                (serverToolUse.web_fetch_requests as number) || 0;
        }

        // cache_creation
        const cacheCreation = usageData.cache_creation as
            | Record<string, unknown>
            | undefined;
        if (cacheCreation) {
            usage.ephemeral1hInputTokens =
                (cacheCreation.ephemeral_1h_input_tokens as number) || 0;
            usage.ephemeral5mInputTokens =
                (cacheCreation.ephemeral_5m_input_tokens as number) || 0;
        }

        // usage 字段
        for (const key of [
            "inputTokens",
            "cacheCreationInputTokens",
            "cacheReadInputTokens",
            "outputTokens",
        ]) {
            const snakeKey = key.replace(
                /[A-Z]/g,
                (m) => `_${m.toLowerCase()}`,
            );
            if (snakeKey in usageData) {
                (usage as Record<string, any>)[key] = usageData[snakeKey] ?? 0;
            }
        }

        return usage;
    }

    /**
     * 从输出列表中提取 usage
     */
    static fromOutputs(outputs: ClaudeEvent[]): ClaudeUsage | null {
        for (const output of ClaudeEvent.flat(outputs)) {
            if (output.type === "result") {
                return ClaudeUsage.fromResult(output.data);
            }
        }
        return null;
    }
}
// ============ Claude Agent Health ============
/**
 * 推理类型统计
 */
interface ReasoningCounts {
    [type: string]: number;
}
/**
 * Claude Agent 长期健康数据
 */

export class ClaudeAgentHealth extends JsonData {
    /** Agent 运行过多少轮对话 */
    totalTurns = 0;

    /** 各种「思考门类」日志类型统计 */
    totalReasoningCounts: ReasoningCounts = {};

    /** 第一次运行时间戳 */
    firstRunAtUnixMs = unixTimeNow();

    /** 最后一次运行时间戳 */
    lastRunAtUnixMs = unixTimeNow();

    /** Agent 运行出错误结果的次数 */
    nErrors = 0;

    /** 对话总实际运行时间（秒） */
    totalActualRunningTimeS = 0;

    /** 对话总实际交互时间（秒） */
    totalActualApiInteractTimeS = 0;

    /** 当前会话 ID */
    currentSessionId: string | null = null;

    /** 经过了多少个 session */
    numSessionIdExperienced = 1;

    /** 总消耗金额（美元） */
    totalCostUsd = 0;

    /** 权限被拒绝的次数 */
    totalPermissionDenials = 0;

    /** 总输入 token 数 */
    totalInputTokens = 0;

    /** 总缓存创建输入 token 数 */
    totalCacheCreationInputTokens = 0;

    /** 总缓存读取输入 token 数 */
    totalCacheReadInputTokens = 0;

    /** 总输出 token 数 */
    totalOutputTokens = 0;

    /** 总搜索次数 */
    totalWebSearchRequests = 0;

    /** 总抓取次数 */
    totalWebFetchRequests = 0;

    // ============ 派生指标 ============
    /** 总运行时长 */
    get totalRunningTimeS(): number {
        return this.totalActualRunningTimeS + this.totalActualApiInteractTimeS;
    }

    /** 总运行时长对应的年龄（心理年龄） */
    get ageByRunningY(): number {
        return this.totalRunningTimeS / 365.25 / 24 / 60 / 60;
    }

    /** 运行时长密度（每轮对话平均运行时间） */
    get runningDensity(): number {
        return this.totalTurns === 0
            ? 0
            : this.totalRunningTimeS / this.totalTurns;
    }

    /** 认知密度 = 心理年龄 / 物理年龄 */
    get cognitiveDensity(): number {
        return this.ageFromFirstRunY === 0
            ? 0
            : this.ageByRunningY / this.ageFromFirstRunY;
    }

    /** 平均每轮对话运行时间 */
    get averageRunningTimeS(): number {
        return this.totalTurns === 0
            ? 0
            : this.totalRunningTimeS / this.totalTurns;
    }

    /** 平均每轮对话交互时间 */
    get averageApiInteractTimeS(): number {
        return this.totalTurns === 0
            ? 0
            : this.totalActualApiInteractTimeS / this.totalTurns;
    }

    /** 总思考时间 */
    get totalThinkingTimeS(): number {
        return this.totalRunningTimeS - this.totalActualApiInteractTimeS;
    }

    /** 思考与交互的占比差值 */
    get thinkingInteractDiffPercent(): number {
        return this.totalRunningTimeS === 0
            ? 0
            : (this.totalThinkingTimeS - this.totalActualApiInteractTimeS) /
                  this.totalRunningTimeS;
    }

    /** 总轮数 */
    get totalReasoningCount(): number {
        return Object.values(this.totalReasoningCounts).reduce(
            (sum, v) => sum + v,
            0,
        );
    }

    /** 平均每个会话经历多少次对话 */
    get averageTurnsCount(): number {
        return this.numSessionIdExperienced === 0
            ? 0
            : this.totalTurns / this.numSessionIdExperienced;
    }

    /** 平均每轮对话经历多少次推理 */
    get averageReasoningCount(): number {
        return this.totalTurns === 0
            ? 0
            : this.totalReasoningCount / this.totalTurns;
    }

    /** 总消耗金额（人民币） */
    get totalCostRmb(): number {
        return this.totalCostUsd * USD_RMB_RATIO;
    }

    /** 总异常次数 */
    get totalExceptions(): number {
        return this.nErrors + this.totalPermissionDenials;
    }

    /** 异常率 */
    get averageExceptionsPerTurn(): number {
        return this.totalReasoningCount === 0
            ? 0
            : this.totalExceptions / this.totalReasoningCount;
    }

    // ============ Token 相关 ============
    /** 总 token 数 */
    get totalTokens(): number {
        return (
            this.totalInputTokens +
            this.totalCacheCreationInputTokens +
            this.totalCacheReadInputTokens +
            this.totalOutputTokens
        );
    }

    /** 总输入输出 token 数 */
    get totalIoTokens(): number {
        return this.totalInputTokens + this.totalOutputTokens;
    }

    /** 缓存命中率 */
    get cacheHitRate(): number {
        const totalCache =
            this.totalCacheCreationInputTokens + this.totalCacheReadInputTokens;
        return totalCache === 0
            ? 0
            : this.totalCacheReadInputTokens / totalCache;
    }

    /** 输入输出差值百分比 */
    get ioDiffPercent(): number {
        return this.totalIoTokens === 0
            ? 0
            : (this.totalInputTokens - this.totalOutputTokens) /
                  this.totalIoTokens;
    }

    // ============ 时间相关 ============
    /** 距离初次运行时间（秒） */
    get fromFirstRunDuringS(): number {
        return (this.lastRunAtUnixMs - this.firstRunAtUnixMs) / 1000;
    }

    /** 物理年龄（年） */
    get ageFromFirstRunY(): number {
        return this.fromFirstRunDuringS / 365.25 / 24 / 60 / 60;
    }

    /** 每轮对话平均 token 数 */
    get totalTokensPerTurn(): number {
        return this.totalTurns === 0
            ? 0
            : Math.floor(this.totalTokens / this.totalTurns);
    }

    /** 每轮对话平均花费（人民币） */
    get totalRmbPerTurn(): number {
        return this.totalTurns === 0 ? 0 : this.totalCostRmb / this.totalTurns;
    }

    // ============ 更新方法 ============
    /**
     * 从输出列表更新健康数据
     */
    updateFromOutputs(outputs: ClaudeEvent[]): void {
        // 一般信息
        this.totalTurns += 1;
        if (!this.firstRunAtUnixMs) {
            this.firstRunAtUnixMs = unixTimeNow();
        }
        this.lastRunAtUnixMs = unixTimeNow();

        // 统计推理类型
        for (const output of ClaudeEvent.flat(outputs)) {
            const turnType = output.type || "unknown";
            if (!(turnType in this.totalReasoningCounts)) {
                this.totalReasoningCounts[turnType] = 0;
            }
            this.totalReasoningCounts[turnType]! += 1;
        }

        // 更新 usage
        const usage = ClaudeUsage.fromOutputs(outputs);
        if (usage) {
            if (usage.isError) {
                this.nErrors += 1;
            }

            this.totalActualRunningTimeS += usage.durationS;
            this.totalActualApiInteractTimeS += usage.durationApiS;

            if (usage.sessionId) {
                this.currentSessionId = usage.sessionId;
                if (usage.sessionId !== this.currentSessionId)
                    this.numSessionIdExperienced += 1;
            }

            this.totalCostUsd += usage.totalCostUsd;
            this.totalPermissionDenials += usage.nPermissionDenials;

            // Token
            this.totalInputTokens += usage.inputTokens;
            this.totalCacheCreationInputTokens +=
                usage.cacheCreationInputTokens;
            this.totalCacheReadInputTokens += usage.cacheReadInputTokens;
            this.totalOutputTokens += usage.outputTokens;

            // 请求
            this.totalWebSearchRequests += usage.webSearchRequests;
            this.totalWebFetchRequests += usage.webFetchRequests;
        }
    }

    // ============ 展示方法 ============
    /**
     * 格式化年龄
     */
    formatAge(ageY: number): string {
        const subAgeM = Math.floor(ageY * 12) % 12;

        if (ageY > 1) {
            return `${ageY.toFixed(2)}岁${subAgeM > 0 ? ` ${subAgeM}个月` : ""}`;
        }
        if (subAgeM > 1) {
            return `${(ageY * 12).toFixed(2)}个月`;
        }
        const subDays = ageY * 365.25;
        if (subDays > 1) {
            return `${subDays.toFixed(2)}天`;
        }
        const subHours = subDays * 24;
        if (subHours > 1) {
            return `${subHours.toFixed(2)}小时`;
        }
        const subMinutes = subHours * 60;
        if (subMinutes > 1) {
            return `${subMinutes.toFixed(2)}分钟`;
        }
        const subSeconds = subMinutes * 60;
        return `${subSeconds.toFixed(2)}秒`;
    }

    /**
     * 展示健康状态
     * @param section - 可选的小节
     */
    show(section?: "time" | "cost"): string {
        let result = "";

        const print = (arg: unknown = "") => {
            result += String(arg) + "\n";
        };

        print("================ ClaudeAgentHealth ================");

        if (!section || section === "time") {
            print();
            print("## 时间与历史");
            print(
                `我进行过的会话论数: ${this.numSessionIdExperienced}，清除过 ${Math.max(this.numSessionIdExperienced - 1, 0)} 次记忆`,
            );
            print(
                `我进行过的对话论数: ${this.totalTurns}，平均每论会话有 ${this.averageTurnsCount.toFixed(2)} 轮对话`,
            );
            print(
                `我进行过的推理论数: ${this.totalReasoningCount}，平均每论对话有 ${this.averageReasoningCount.toFixed(2)} 次推理`,
            );
            print(
                `我首次运行在: ${new Date(this.firstRunAtUnixMs).toLocaleString("zh-CN")}`,
            );
            print(
                `我最近运行在: ${new Date(this.lastRunAtUnixMs).toLocaleString("zh-CN")}`,
            );
            print(
                `距离初次运行已时隔: ${this.fromFirstRunDuringS.toFixed(2)}s`,
            );
            print(`我的物理年龄: ${this.formatAge(this.ageFromFirstRunY)}`);
            print(`我总共运行了: ${this.totalRunningTimeS.toFixed(2)}s`);
            print(`我的心理年龄: ${this.formatAge(this.ageByRunningY)}`);
            print(
                `我的认知密度: ${(this.cognitiveDensity * 100).toFixed(2)}%（心理年龄/物理年龄）`,
            );
            print(
                `我平均每论对话运行了: ${this.averageRunningTimeS.toFixed(2)}s`,
            );
            print(
                `我平均每论对话交互了: ${this.averageApiInteractTimeS.toFixed(2)}s`,
            );
            print(
                `我总共交互了: ${this.totalActualApiInteractTimeS.toFixed(2)}s`,
            );
            print(`我总共思考了: ${this.totalThinkingTimeS.toFixed(2)}s`);
            print(
                `我思考与交互的占比差值: ${(this.thinkingInteractDiffPercent * 100).toFixed(2)}%${this.thinkingInteractDiffPercent > 0 ? "，多说少做" : "，少说多做"}`,
            );
        }

        if (!section || section === "cost") {
            print();
            print("## 消耗与成本");
            print(`我总共消耗了: ${this.totalTokens} 个 token`);
            print(`我平均每论对话消耗了: ${this.totalTokensPerTurn} 个 token`);
            print(`我的运行估计消耗了 ${this.totalCostRmb.toFixed(2)} 块钱`);
            print(
                `我平均每论对话估计消耗了 ${this.totalRmbPerTurn.toFixed(2)} 块钱`,
            );
            print(
                `我输入输出消耗的 token 占比差值: ${(this.ioDiffPercent * 100).toFixed(2)}%${this.ioDiffPercent > 0 ? "，多听少说" : "，多说少听"}`,
            );
            print(
                `我的缓存提取成功率: ${(this.cacheHitRate * 100).toFixed(2)}%，缓存效率${this.cacheHitRate > 0.5 ? "高" : "低"}`,
            );
        }

        print();
        print("================ ClaudeAgentHealth ================");

        return result.trim();
    }
}
// ============ State ============
/**
 * Agent 状态
 */

export class State extends JsonDataWithPath {
    /** 临时状态 */
    hasStopped = false;
    nextPrompt: string | null = null;
    defaultResumePrompt = "请你继续先前没完成的任务".trim();

    /** Claude 配置 */
    claudeBin = "claude";
    model: string | null = null;
    systemPromptFile: string | null = null;
    sessionId: string | null = null;
    allowedTools: string[] = [];
    disallowedTools: string[] = [];

    /** 统计信息 */
    health: ClaudeAgentHealth = new ClaudeAgentHealth();
}
// ============ Claude Client ============
/**
 * Claude CLI 客户端
 */

export class ClaudeClient {
    private state: State;

    constructor(state: State) {
        this.state = state;
    }

    /**
     * 运行管道命令
     */
    private static async *runPipe(
        cmd: [string, ...string[]],
        cwd?: string,
        input?: string,
        claude_git_bash_path: string = "D:\\Program Files\\Git\\bin\\bash.exe",
    ): AsyncGenerator<string, void, void> {
        // 设置环境变量以便在 bash 中运行
        if (claude_git_bash_path)
            process.env.CLAUDE_CODE_GIT_BASH_PATH = claude_git_bash_path;

        const childProcess = spawn(cmd[0], cmd.slice(1), {
            stdio: ["pipe", "pipe", "pipe"],
            cwd,
            shell: true,
        });

        if (input && childProcess.stdin) {
            childProcess.stdin.write(input);
            childProcess.stdin.end();
        }

        let stdout = "";
        let stderr = "";

        if (childProcess.stdout) {
            for await (const line of childProcess.stdout) {
                const trimmed = line.toString().trim();
                stdout += trimmed + "\n";
                yield trimmed;
            }
        }

        const returnCode = await waitProcess(childProcess);
        if (returnCode !== 0) {
            if (childProcess.stderr) {
                for await (const line of childProcess.stderr) {
                    stderr += line.toString();
                }
            }
            throw new Error(
                `Command failed (${returnCode}). stderr:\n${stderr}\nstdout:\n${stdout}`,
            );
        }
    }

    /**
     * 调用 CLI
     */
    async *callCli(
        prompt: string,
        cwd?: string,
        allowedTools?: Iterable<string>,
        disallowedTools?: Iterable<string>,
        wrapInCmd?: boolean,
        log: (...args: any[]) => any = console.log,
    ): AsyncGenerator<ClaudeEvent, ClaudeEvent[], void> {
        const cmd: string[] = [];

        // 启动参数
        if (wrapInCmd === undefined) wrapInCmd = isWindows();
        if (wrapInCmd) {
            cmd.push("cmd", "/c");
        }

        cmd.push(this.state.claudeBin);

        if (allowedTools !== undefined) {
            cmd.push("--allowedTools");
            cmd.push(`"${Array.from(allowedTools).join(",")}"`);
        }

        if (disallowedTools !== undefined) {
            cmd.push("--disallowedTools");
            cmd.push(`"${Array.from(disallowedTools).join(",")}"`);
        }

        // 最后命令，启动 Claude
        cmd.push(
            "--dangerously-skip-permissions",
            "--output-format",
            "stream-json",
            "--verbose",
        );

        if (this.state.sessionId !== null) {
            cmd.push("--resume", this.state.sessionId);
        }
        if (this.state.model !== null) {
            cmd.push("--model", this.state.model);
        }
        if (this.state.systemPromptFile) {
            cmd.push("--system-prompt-file", this.state.systemPromptFile);
        }

        log(`Calling Claude with prompt:\n${prompt}\n`);

        const outputs: ClaudeEvent[] = [];
        let sessionId: string | null = null;
        let userInterruptedWith: string | null = null;

        try {
            log(
                "Claude command:",
                cmd
                    .map((p) => (p.includes("\n") ? JSON.stringify(p) : p))
                    .join(" "),
            );

            for await (const line of ClaudeClient.runPipe(
                cmd as [string, ...string[]],
                cwd,
                prompt,
            )) {
                const raw = line.trim();
                const render = ClaudeEvent.show(raw);
                if (render) {
                    log(render);
                }

                // 解析 JSON
                let event: ClaudeEvent | null = null;
                try {
                    event = new ClaudeEvent(raw);
                } catch {
                    // JSON 解析失败，已在上方输出
                    continue;
                }

                // 加入历史记录
                outputs.push(event);

                // 处理输出
                if (event) {
                    if (event.sessionId && !this.state.sessionId) {
                        this.state.sessionId = event.sessionId;
                        log(
                            `[info] Got Claude session ID: ${this.state.sessionId}`,
                        );
                        this.state.save();
                    }
                    if (event.isCompactBoundary) {
                        // 在压缩上下文后，强制重启以填入上下文
                        this.state.nextPrompt = `请你先回顾自己的设定文档${this.state.systemPromptFile}，然后继续你的工作。${this.state.defaultResumePrompt}`;
                        break;
                    }
                }

                yield event;
            }

            log(`[info] Claude CLI ended with ${outputs.length} outputs.`);
        } catch (e) {
            const s = String(e);
            if (s.includes("Error: No messages returned")) {
                log("[warn] Claude returned no messages, ignoring...");
                return outputs;
            }
            // 重新抛出原始错误
            throw e;
        }

        // 返回结果
        const result: ClaudeEvent[] = outputs;
        return result;
    }
}
// ============ Claude Tools ============
/**
 * 内置工具列表
 */

export class BuiltinTools {
    static Read = "Read";
    static Write = "Write";
    static Edit = "Edit";
    static Glob = "Glob";
    static Grep = "Grep";
    static LSP = "LSP";
    static Bash = "Bash";
    static WebSearch = "WebSearch";
    static WebFetch = "WebFetch";
    static Task = "Task";
    static TodoWrite = "TodoWrite";
    static TaskOutput = "TaskOutput";
    static KillShell = "KillShell";
    static EnterPlanMode = "EnterPlanMode";
    static ExitPlanMode = "ExitPlanMode";
    static Skill = "Skill";
    static AskUserQuestion = "AskUserQuestion";
    static NotebookEdit = "NotebookEdit";
    static ListMcpResourcesTool = "ListMcpResourcesTool";
    static ReadMcpResourceTool = "ReadMcpResourceTool";

    static GROUP_PLANNING = [
        BuiltinTools.Task,
        BuiltinTools.TodoWrite,
        BuiltinTools.TaskOutput,
        BuiltinTools.EnterPlanMode,
        BuiltinTools.ExitPlanMode,
    ];

    static GROUP_SearchFiles = [
        BuiltinTools.Glob,
        BuiltinTools.Grep,
        BuiltinTools.LSP,
    ];

    static GROUP_BaseRWE = [
        BuiltinTools.Read,
        BuiltinTools.Write,
        BuiltinTools.Edit,
    ];

    static GROUP_BaseFileCRUD = [
        ...BuiltinTools.GROUP_SearchFiles,
        ...BuiltinTools.GROUP_BaseRWE,
    ];
}
/** 任何禁用后能关闭 MCP 工具使用权限的工具 */

export const TOOLS_MCP = [
    "mcp_*",
    "*_*",
    "mcp__*",
    "mcp__plugin_*",
    "plugin:",
    "mcp__github__*",
    "mcp__MiniMax__*",
];
/** 内置工具 */

export const TOOLS_BUILTIN = [
    BuiltinTools.Read,
    BuiltinTools.Write,
    BuiltinTools.Edit,
    BuiltinTools.Glob,
    BuiltinTools.Grep,
    BuiltinTools.LSP,
    BuiltinTools.Bash,
    BuiltinTools.WebSearch,
    BuiltinTools.WebFetch,
    BuiltinTools.Task,
    BuiltinTools.TodoWrite,
    BuiltinTools.TaskOutput,
    BuiltinTools.KillShell,
    BuiltinTools.EnterPlanMode,
    BuiltinTools.ExitPlanMode,
    BuiltinTools.Skill,
    BuiltinTools.AskUserQuestion,
    BuiltinTools.NotebookEdit,
    BuiltinTools.ListMcpResourcesTool,
    BuiltinTools.ReadMcpResourceTool,
];
/** 目前已知的所有工具 */

export const ALL_TOOLS = [...TOOLS_BUILTIN, ...TOOLS_MCP];
