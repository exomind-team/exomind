/**
 * Agent - 核心 Agent 框架
 *
 * 从 Python agent.py 迁移，包含 ClaudeEvent、ClaudeUsage、ClaudeAgentHealth、ClaudeClient、Agent
 *
 * @module agent
 */
import fs from "fs";
import path from "path";

import { sleep, extract, findFirst, isWindows } from "../util";
import { ClaudeClient, State, ALL_TOOLS, ClaudeEvent } from "./claude";

// ============ Agent ============

/**
 * Agent 主类
 */
export class Agent {
    private _claude: ClaudeClient;
    state: State;

    constructor(state: State) {
        this._claude = new ClaudeClient(state);
        this.state = state;
    }

    /**
     * 确保工具列表无重复、排序规整
     */
    regulateTools(): this {
        this.state.allowedTools = [...new Set(this.state.allowedTools)].sort();
        this.state.disallowedTools = [
            ...new Set(this.state.disallowedTools),
        ].sort();
        return this;
    }

    /**
     * 允许使用某个工具
     */
    allowTool(...toolName: string[]): this {
        this.state.allowedTools.push(...toolName);
        for (const tool of toolName) {
            const idx = this.state.disallowedTools.indexOf(tool);
            if (idx !== -1) {
                this.state.disallowedTools.splice(idx, 1);
            }
        }
        return this;
    }

    /**
     * 禁止使用某个工具
     */
    disallowTool(...toolName: string[]): this {
        for (const tool of toolName) {
            const idx = this.state.allowedTools.indexOf(tool);
            if (idx !== -1) {
                this.state.allowedTools.splice(idx, 1);
            }
        }
        this.state.disallowedTools.push(...toolName);
        return this;
    }

    /**
     * 禁用所有工具
     */
    disallowAllTools(): this {
        return this.disallowTool(...ALL_TOOLS);
    }

    /**
     * 处理 Claude 调用
     */
    private async *_handleClaude(
        nextPrompt?: string,
        cwd?: string,
    ): AsyncGenerator<ClaudeEvent, ClaudeEvent, void> {
        const prompt =
            nextPrompt ||
            this.state.nextPrompt ||
            this.state.defaultResumePrompt;

        if (this.state.nextPrompt) {
            this.state.nextPrompt = null;
            this.saveState();
        }

        // 运行并得到结果
        const outputs = yield* this._claude.callCli(
            prompt,
            cwd,
            this.state.allowedTools,
            this.state.disallowedTools,
            isWindows(),
        );

        // 更新状态
        this.state.hasStopped = true;
        let sessionId: string | null = null;
        let userInterruptedWith: string | null = null;

        if (outputs.length > 0) {
            const lastOutput = outputs[outputs.length - 1]!;
            if (lastOutput.sessionId) {
                sessionId = lastOutput.sessionId;
            }
        }

        // 返回结果
        const result = {
            outputs,
            sessionId,
            userInterruptedWith,
        } as {
            outputs: ClaudeEvent[];
            sessionId: string | null;
            userInterruptedWith: string | null;
        };

        if (result.sessionId) {
            this.state.sessionId = result.sessionId;
        }
        if (result.userInterruptedWith) {
            this.state.nextPrompt = result.userInterruptedWith;
        }

        return result as unknown as ClaudeEvent;
    }

    /**
     * 一个来回，保证运行一次正常的 Claude CLI 并获取反馈
     *
     * @param nextPrompt - 指定的提示词
     * @param cwd - 工作目录
     */
    async *turn(
        nextPrompt?: string,
        cwd?: string,
    ): AsyncGenerator<ClaudeEvent, ClaudeEvent[], unknown> {
        // 先保存
        this.saveState();

        let cooldownT = 5;
        const events: ClaudeEvent[] = [];

        while (true) {
            try {
                while (true) {
                    const eventIter = extract(
                        this._handleClaude(nextPrompt, cwd),
                    );
                    for await (const evt of eventIter) {
                        if (evt) {
                            yield evt;
                            events.push(evt);
                        }
                    }

                    // 收纳对话
                    const outputs = events;
                    this.state.health.updateFromOutputs(outputs);
                    this.state.save();

                    if (
                        outputs.length > 0 &&
                        outputs[outputs.length - 1]!.isCompactBoundary
                    ) {
                        continue; // 如果压缩了对话，就不要停下来
                    }
                    break;
                }
                cooldownT = Math.max(cooldownT - 1, 5);
                break;
            } catch (e) {
                const error = e as Error;
                console.log(`[error] ${error.message}`);
                console.log(`[error] ${error.stack}`);

                // 查找错误事件
                const errorEvt = findFirst(
                    (evt) =>
                        evt &&
                        evt.type === "result" &&
                        (evt.get("is_error") as boolean) &&
                        Array.isArray(evt.get("errors")) &&
                        (evt.get("errors") as unknown[]).some(
                            (err) =>
                                typeof err === "string" &&
                                err.includes("usage limit exceeded"),
                        ),
                    events,
                );

                const rawEvt = findFirst(
                    (evt) =>
                        (evt &&
                            evt.type === "result" &&
                            (evt.get("is_error") as boolean) &&
                            (evt.get("errors") as unknown[] | undefined)?.some(
                                (err) =>
                                    typeof err === "string" &&
                                    err.includes("No conversation found"),
                            )) ??
                        false,
                    events,
                );

                if (errorEvt) {
                    console.log("[WIP] 处理：额度用尽");
                }

                if (rawEvt) {
                    this.state.sessionId = null;
                    this.saveState();
                    console.log(
                        "[warn] Claude session not found, restarting...",
                    );
                    continue;
                }

                console.log(`[loop] restarting for ${cooldownT}s...`);
                await sleep(cooldownT * 1000);
                cooldownT += 1;
            }
        }

        return events;
    }

    /**
     * 循环运行
     */
    async cycle(): Promise<void> {
        while (true) {
            const outputs = await extract(this.turn()).collect();
            console.log(
                `Claude run stopped with return ${outputs.length} outputs.`,
            );
        }
    }

    /**
     * 保存状态
     */
    saveState(): void {
        this.state.save();
    }
}

// ============ 工具函数 ============

/**
 * 获取系统提示词路径
 */
export function getSystemPromptPath(
    agentFolderOrFile: string | null,
): string | null {
    if (!agentFolderOrFile) {
        return null;
    }

    if (fs.existsSync(agentFolderOrFile)) {
        if (fs.statSync(agentFolderOrFile).isDirectory()) {
            const candidates = [
                "agent.md",
                "AGENT.md",
                "readme.md",
                "README.md",
            ];
            for (const fileName of candidates) {
                const filePath = path.join(agentFolderOrFile, fileName);
                if (fs.existsSync(filePath)) {
                    console.log(`[info] use system prompt: ${filePath}`);
                    return filePath;
                }
            }
            throw new Error("no system prompt file found");
        } else {
            return agentFolderOrFile;
        }
    }
    return null;
}
