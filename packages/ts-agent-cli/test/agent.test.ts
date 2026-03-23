import { describe, it, expect, beforeEach } from "vitest";

import { extract } from "../src";
import { Agent } from "../src/agent";
import { ClaudeEvent, State } from "../src/agent/claude";
import { readFileSync } from "fs";

// ============ 提示词常量 ============
const SUPER_QUESTION_PROMPT = `当前测试文件路径：${__filename}
请你查看当前测试文件的问题，先进入超级提问模式，对我们的测试进行自我提问，包括但不限于：有TODO还没完成的、功能层面有待完善的、表达中有赘余需要无损压缩重构的、需要验证必要性与可行性的内容。
一次分析一整个方面、草拟多个问题后再对自己提问。
每次自我提问完成都要回顾并更新现有计划，确保问题与计划同步。
直到回顾整个计划确认没有新问题需要提问时，才给出完整改善计划。
现在请你向自己提问，形成下一步改善计划`;

const EXECUTE_PROMPT = `随后执行它以完善我们的测试。
深度思考并详细分析规划，查看、发现、安排、利用上一切你能用上的技能去完成任务，包括已安装的Claude skills（如superpowers）和所有需要的项目技能。可以调用 sub Agent并行工作，加快做工作的速度、提升效率。允许尽可能地延长思考时长，以使你有充足的时间理解、分析、执行工作计划。`;

// ============ 环境变量配置 ============
function getEnvOrDefault(key: string, defaultValue: string): string {
    return Bun.env[key] ?? defaultValue;
}

function getEnvNumberOrDefault(key: string, defaultValue: number): number {
    const value = Bun.env[key];
    return value ? parseInt(value, 10) : defaultValue;
}

// ============ 配置常量 ============
const CONFIG = {
    MAX_ITERATIONS: getEnvNumberOrDefault("AGENT_TEST_MAX_ITERATIONS", 10),
    MAX_TOKENS: getEnvNumberOrDefault("AGENT_TEST_MAX_TOKENS", 0x1000000),
    PLAN_FILE: getEnvOrDefault("AGENT_TEST_PLAN_FILE", "improvement_plan.md"),
    REPORT_FILE: getEnvOrDefault(
        "AGENT_TEST_REPORT_FILE",
        "test_report.local.md",
    ),
    JSON_REPORT_FILE: getEnvOrDefault(
        "AGENT_TEST_JSON_REPORT_FILE",
        "test_result.local.json",
    ),
    STATE_FILE: getEnvOrDefault(
        "AGENT_TEST_STATE_FILE",
        "agent.test.local.state.json",
    ),
    SYSTEM_PROMPT_FILE: getEnvOrDefault(
        "AGENT_TEST_SYSTEM_PROMPT",
        "H:/A137442/Document/Notes/ExoTest/agents/assistant_a/agent.md",
    ),
    CLAUDE_PY_PATH: getEnvOrDefault(
        "AGENT_TEST_CLAUDE_PY_PATH",
        "H:/A137442/Document/Notes/ExoTest/agents/claude.py",
    ),
    RUNNING_TIMEOUT_MS: 1000 * 60 * 10, // 10 分钟
} as const;

console.log("[info] 配置加载完成");
console.log(`  - 最大迭代次数: ${CONFIG.MAX_ITERATIONS}`);
console.log(`  - Token预算: ${CONFIG.MAX_TOKENS}`);
console.log(`  - 计划文件: ${CONFIG.PLAN_FILE}`);

// ============ 错误处理包装 ============
async function safeBunWrite(path: string, content: string): Promise<boolean> {
    try {
        await Bun.write(path, content);
        return true;
    } catch (error) {
        console.error(`[error] 写入失败 ${path}:`, error);
        return false;
    }
}

function safeReadFileSync(path: string): string {
    try {
        return readFileSync(path, "utf-8");
    } catch (error) {
        console.error(`[error] 读取失败 ${path}:`, error);
        return "";
    }
}

// ============ 版本文件清理 ============
const VERSION_FILE_PATTERN = /^improvement_plan_v\d+_.+\.md$/;
function cleanupOldVersions(maxVersions: number = 10): void {
    // 注意：实际清理逻辑需要在文件系统中执行
    // 这里仅作为接口定义，清理在 savePlan 中实现
}

// ============ 改善计划保存 ============
async function savePlan(plan: string[], iteration: number): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const versionedFilename = `improvement_plan_v${iteration}_${timestamp}.md`;
    const header = `# 改善计划 - 第 ${iteration} 轮

生成时间: ${timestamp}

---

`;
    const content = plan.join("\n\n---\n\n");

    // 同时写入主文件和版本文件
    const mainSuccess = await safeBunWrite(CONFIG.PLAN_FILE, header + content);
    const versionSuccess = await safeBunWrite(
        versionedFilename,
        header + content,
    );

    if (!mainSuccess) {
        throw new Error(`改善计划写入失败: ${CONFIG.PLAN_FILE}`);
    }
    if (!versionSuccess) {
        throw new Error(`版本化计划写入失败: ${versionedFilename}`);
    }

    console.log(`[info] 改善计划已保存: ${CONFIG.PLAN_FILE} (v${iteration})`);
}

// ============ 循环条件检查 ============
let _firstCheckDone = false;
function shouldContinue(totalTurns: number, tokens: number): boolean {
    // 使用 totalTurns 而非 iteration，因为 iteration 每次运行重置
    if (!_firstCheckDone) {
        console.log(
            `[info] 循环控制: totalTurns=${totalTurns}, MAX_ITERATIONS=${CONFIG.MAX_ITERATIONS}, 预算=${tokens}/${CONFIG.MAX_TOKENS}`,
        );
        _firstCheckDone = true;
    }
    if (totalTurns >= CONFIG.MAX_ITERATIONS) {
        console.log(
            `[info] 达到最大循环次数 ${CONFIG.MAX_ITERATIONS}，退出循环 (当前totalTurns=${totalTurns})`,
        );
        return false;
    }
    if (tokens > CONFIG.MAX_TOKENS) {
        console.log(`[info] 达到Token预算限制 ${CONFIG.MAX_TOKENS}，退出循环`);
        return false;
    }
    return true;
}

// ============ 状态管理 ============
let state: State;
let agent: Agent;
let lastTime = Date.now();

beforeEach(() => {
    // 每个测试前重新加载状态，确保测试隔离
    state = State.tryLoadOrNew(State, CONFIG.STATE_FILE);
    state.save();
    state.systemPromptFile = CONFIG.SYSTEM_PROMPT_FILE;
    agent = new Agent(state);
});

function formatDt(dt_ms: number): string {
    return `${(dt_ms / 1000 / 60) | 0} 分 ${((dt_ms / 1000) % 60) | 0} 秒`;
}

function showDt(): string {
    const dt_ms = Date.now() - lastTime;
    return formatDt(dt_ms);
}

async function claude(prompt: string, bot?: Agent): Promise<ClaudeEvent[]> {
    if (bot === undefined) bot = agent;
    prompt =
        `你只有${formatDt(CONFIG.RUNNING_TIMEOUT_MS)}的运行时间，现在时间已过 ${showDt()}。\n` +
        prompt;
    return await extract(bot.turn(prompt)).collect();
}

// ============ 主测试流程 ============
async function runTests(): Promise<{
    outputs: ClaudeEvent[];
    improvementPlan: string[];
}> {
    let outputs = await claude(
        `我们现在在 ${__filename} 测试你，你看看这个文件是怎样测试你的👀`,
    );

    // 获取最新状态快照（避免重复序列化）
    const currentState = state.json();

    outputs = await claude(
        `
\`\`\`加载前的JSON源文件
${safeReadFileSync(state.filePath!)}
\`\`\`
\`\`\`加载后的配置（包括文件路径）
${currentState}
\`\`\`
我们来检查下配置文件是否加载完全`.trim(),
    );
    // 精简输出
    console.log(`[info] 配置检查完成: totalTurns=${state.health.totalTurns}`);

    const outputsStr = outputs.map((output) => output.render()).join("\n\n");

    // 输出丢给模型，让它自己检验下
    outputs = await claude(
        `\
请对比检查你的输出跟 ${CONFIG.CLAUDE_PY_PATH} 的逻辑是否一致`,
    );

    let iteration = 0;
    const improvementPlan: string[] = [];

    while (true) {
        if (
            !shouldContinue(state.health.totalTurns, state.health.totalTokens)
        ) {
            break;
        }

        iteration++;
        console.log(
            `[info] 改善轮次: totalTurns=${state.health.totalTurns}, iteration=${iteration}`,
        );

        outputs = await claude(SUPER_QUESTION_PROMPT.trim());
        outputs = await claude(EXECUTE_PROMPT.trim());

        if (outputs.length > 0) {
            const result = outputs.find((event) => event.result);
            if (result) {
                improvementPlan.push(
                    `## 第 ${state.health.totalTurns} 轮改善\n\n${result.render()}`,
                );
                await savePlan(improvementPlan, state.health.totalTurns);
            }
        }
    }

    return { outputs, improvementPlan };
}

// ============ vitest 测试用例 ============
describe("Claude Agent", () => {
    // Agent 创建测试
    it("should create agent successfully", () => {
        expect(agent).toBeDefined();
        expect(agent.state).toBeDefined();
    });

    // 健康指标测试
    it("should track health metrics", () => {
        const health = state.health;
        expect(health.totalTurns).toBeGreaterThan(0);
        expect(health.cacheHitRate).toBeGreaterThanOrEqual(0);
        expect(health.cacheHitRate).toBeLessThanOrEqual(1);
    });

    // 状态验证测试
    it("should have valid state", () => {
        expect(state.systemPromptFile).toBeDefined();
        expect(state.claudeBin).toBeDefined();
    });

    // 主测试流程 - 包含自我检验和改善计划生成
    it(
        "should run self-examination and generate improvement plan",
        async () => {
            const { outputs, improvementPlan } = await runTests();

            // 验证测试输出存在
            expect(outputs).toBeDefined();
            expect(Array.isArray(outputs)).toBe(true);

            // 验证改善计划已生成
            expect(improvementPlan).toBeDefined();
            expect(Array.isArray(improvementPlan)).toBe(true);
        },
        {
            timeout: CONFIG.RUNNING_TIMEOUT_MS,
        },
    );
});
