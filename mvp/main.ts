#!/usr/bin/env node

/**
 * ExoMind MVP - 外心最小验证版
 * 记录生命中的每一个事件
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
    Event,
    TimeBlock,
    PlannedTimeBlock,
    ExoMindLogs,
    ExoMindApp,
    UUID,
    Timestamp,
    NoteContent,
    Tag,
    JSONObject,
    JSONValue
} from './types';

// ============ ANSI 颜色 ============

const COLORS = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m',
};

function color(code: string, text: string): string {
    return `${code}${text}${COLORS.reset}`;
}

// ============ 工具函数 ============

function formatTime(timestamp: Timestamp): string {
    const date = new Date(timestamp);
    const now = new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');

    let timeStr = '';
    if (date.getFullYear() !== now.getFullYear()) {
        timeStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')} ${hours}:${minutes}:${seconds}`;
    } else if (date.getDate() !== now.getDate()) {
        timeStr = `${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')} ${hours}:${minutes}:${seconds}`;
    } else {
        timeStr = `${hours}:${minutes}:${seconds}`;
    }
    return timeStr;
}

function formatDuration(ms: number): string {
    const minutes = Math.floor(ms / 60000);

    if (minutes < 1) {
        const seconds = Math.floor(ms / 1000);
        return `${seconds} 秒`;
    }

    if (minutes < 60) {
        return `${minutes} 分钟`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours} 小时 ${remainingMinutes} 分钟`;
}

// ============ Event 实现 ============

class EventImpl implements Event {
    readonly id: UUID
    readonly timestamp: Timestamp

    private _content: NoteContent
    private _tags: Set<Tag>
    private _meta?: JSONObject

    constructor(content: NoteContent, tags: Set<Tag> = new Set(), meta?: JSONObject) {
        this.id = randomUUID()
        this.timestamp = Date.now() as Timestamp
        this._content = content
        this._tags = new Set(tags)
        this._meta = meta
    }

    get content(): NoteContent { return this._content }
    get tags(): Set<Tag> { return this._tags }
    get meta(): JSONObject | void { return this._meta }

    toJSON(): JSONObject {
        return {
            id: this.id,
            timestamp: this.timestamp,
            content: this._content,
            tags: [...this._tags],
            ...(this._meta && { meta: this._meta })
        }
    }

    static fromJSON(json: JSONObject): EventImpl {
        const tags = new Set<Tag>()
        if (Array.isArray(json.tags)) {
            for (const t of json.tags) {
                if (typeof t === 'string') tags.add(t)
            }
        }
        const event = new EventImpl(
            typeof json.content === 'string' ? json.content : '',
            tags,
            json.meta as JSONObject | undefined
        )
        event._setIdAndTimestamp(json.id as UUID, json.timestamp as Timestamp)
        return event
    }

    private _setIdAndTimestamp(id: UUID, timestamp: Timestamp): void {
        Object.assign(this, { id, timestamp })
    }
}

// ============ TimeBlock 实现 ============

class TimeBlockImpl implements TimeBlock {
    readonly id: UUID
    readonly name: string

    private _note: NoteContent
    private _tags: Set<Tag>
    readonly startId: UUID
    readonly endId: UUID
    private _meta?: JSONObject

    constructor(
        start: Event,
        end: Event,
        name: string,
        note: NoteContent,
        tags: Set<Tag> = new Set(),
        meta?: JSONObject
    ) {
        this.id = randomUUID()
        this.name = name
        this._note = note
        this._tags = new Set(tags)
        this.startId = start.id
        this.endId = end.id
        this._meta = meta
    }

    get note(): NoteContent { return this._note }
    get tags(): Set<Tag> { return this._tags }
    get meta(): JSONObject | void { return this._meta }

    toJSON(): JSONObject {
        return {
            id: this.id,
            name: this.name,
            note: this._note,
            startId: this.startId,
            endId: this.endId,
            tags: [...this._tags],
            ...(this._meta && { meta: this._meta })
        }
    }
}

// ============ PlannedTimeBlock 实现 ============

class PlannedTimeBlockImpl implements PlannedTimeBlock {
    readonly startId: UUID
    readonly name: string

    private _tags: Set<Tag>
    private _meta?: JSONObject

    constructor(startId: UUID, name: string, tags: Set<Tag> = new Set(), meta?: JSONObject) {
        this.startId = startId
        this.name = name
        this._tags = new Set(tags)
        this._meta = meta
    }

    get tags(): Set<Tag> { return this._tags }
    get meta(): JSONObject | void { return this._meta }

    toJSON(): JSONObject {
        return {
            startId: this.startId,
            name: this.name,
            tags: [...this._tags],
            ...(this._meta && { meta: this._meta })
        }
    }

    static fromJSON(json: JSONObject): PlannedTimeBlockImpl {
        const tags = new Set<Tag>()
        if (Array.isArray(json.tags)) {
            for (const t of json.tags) {
                if (typeof t === 'string') tags.add(t)
            }
        }
        return new PlannedTimeBlockImpl(
            json.startId as UUID,
            typeof json.name === 'string' ? json.name : '',
            tags,
            json.meta as JSONObject | undefined
        )
    }
}

// ============ ExoMindLogs 实现 ============

class ExoMindLogsImpl implements ExoMindLogs {
    private eventsMap: Map<UUID, Event> = new Map()
    private timeBlocksMap: Map<UUID, TimeBlock> = new Map()

    get events(): IterableIterator<Event> {
        return this.eventsMap.values()
    }

    get eventsByTime(): IterableIterator<Event> {
        const sorted = [...this.eventsMap.values()].sort((a, b) => a.timestamp - b.timestamp)
        return sorted[Symbol.iterator]()
    }

    getEventById(id: UUID): Event | void {
        return this.eventsMap.get(id)
    }

    addEvent(content: NoteContent, tags: Set<Tag>, meta?: JSONObject): Event {
        const event = new EventImpl(content, tags, meta)
        this.eventsMap.set(event.id, event)
        return event
    }

    eventsInBlock(timeBlock: TimeBlock): IterableIterator<Event> {
        const startTime = this.getEventById(timeBlock.startId)?.timestamp ?? 0
        const endTime = this.getEventById(timeBlock.endId)?.timestamp ?? Infinity
        const events: Event[] = []
        for (const event of this.events) {
            if (event.timestamp >= startTime && event.timestamp <= endTime) {
                events.push(event)
            }
        }
        return events[Symbol.iterator]()
    }

    get timeBlocks(): IterableIterator<TimeBlock> {
        return this.timeBlocksMap.values()
    }

    get timeBlocksByStartTime(): IterableIterator<TimeBlock> {
        const sorted = [...this.timeBlocksMap.values()].sort(
            (a, b) => (this.getEventById(a.startId)?.timestamp ?? 0) - (this.getEventById(b.startId)?.timestamp ?? 0)
        )
        return sorted[Symbol.iterator]()
    }

    get timeBlocksByEndTime(): IterableIterator<TimeBlock> {
        const sorted = [...this.timeBlocksMap.values()].sort(
            (a, b) => (this.getEventById(a.endId)?.timestamp ?? 0) - (this.getEventById(b.endId)?.timestamp ?? 0)
        )
        return sorted[Symbol.iterator]()
    }

    getTimeBlockById(id: UUID): TimeBlock | void {
        return this.timeBlocksMap.get(id)
    }

    addTimeBlock(start: Event, end: Event, context: {
        name: string,
        note: NoteContent,
        tags: Set<Tag>,
        meta?: JSONObject,
    }): TimeBlock {
        const block = new TimeBlockImpl(start, end, context.name, context.note, context.tags, context.meta)
        this.timeBlocksMap.set(block.id, block)
        return block
    }

    toJSON(): JSONValue {
        return {
            events: [...this.events].map(e => e.toJSON()),
            timeBlocks: [...this.timeBlocks].map(tb => tb.toJSON())
        }
    }

    loadJSON(json: JSONValue): void {
        this.eventsMap.clear()
        this.timeBlocksMap.clear()

        if (typeof json !== 'object' || json === null) return
        const data = json as JSONObject

        if (Array.isArray(data.events)) {
            for (const e of data.events) {
                const event = EventImpl.fromJSON(e as JSONObject)
                this.eventsMap.set(event.id, event)
            }
        }

        if (Array.isArray(data.timeBlocks)) {
            for (const tb of data.timeBlocks) {
                const obj = tb as JSONObject
                const start = this.getEventById(obj.startId as UUID)
                const end = this.getEventById(obj.endId as UUID)
                if (start && end) {
                    const name = typeof obj.name === 'string' ? obj.name : '未命名时间块'
                    const note = typeof obj.note === 'string' ? obj.note : '' as NoteContent
                    const tags = new Set<Tag>()
                    if (Array.isArray(obj.tags)) {
                        for (const t of obj.tags) {
                            if (typeof t === 'string') tags.add(t)
                        }
                    }
                    const block = new TimeBlockImpl(start, end, name, note, tags, obj.meta as JSONObject | undefined)
                    this.timeBlocksMap.set(block.id, block)
                }
            }
        }
    }
}

// ============ ExoMindApp 实现 ============

class ExoMindAppImpl implements ExoMindApp {
    private _logs: ExoMindLogs
    private rl: readline.Interface
    private dataDir: string
    private dataFile: string
    private activeBlock?: PlannedTimeBlockImpl

    constructor() {
        this._logs = new ExoMindLogsImpl()
        const __dirname = path.dirname(fileURLToPath(import.meta.url))
        this.dataDir = path.join(__dirname, 'data')
        this.dataFile = path.join(this.dataDir, 'exomind.json')
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
        })
    }

    get logs(): ExoMindLogs { return this._logs }

    get activeStartEvent(): Event | void {
        if (this.activeBlock === undefined) return undefined
        return this._logs.getEventById(this.activeBlock.startId)
    }

    isStartEvent(event: Event): boolean {
        return event.tags.has('block_start') || event.content.startsWith('开始')
    }

    isEndEvent(event: Event): boolean {
        return event.tags.has('block_end') || event.content.startsWith('结束')
    }

    addTimeBlock(end: Event, context: { tags: Set<Tag>, meta?: JSONObject }): TimeBlock {
        const start = this.activeStartEvent
        if (start === undefined) throw new Error('No active time block')

        const block = this._logs.addTimeBlock(start, end, {
            name: this.activeBlock!.name,
            note: '',
            tags: context.tags,
            meta: context.meta
        })

        this.activeBlock = undefined
        return block
    }

    showEvent(event: Event): string {
        const time = formatTime(event.timestamp)
        const tags = event.tags.size > 0 ? ` [${[...event.tags].join(', ')}]` : ''
        return `${time}${tags} ${event.content}`
    }

    showTimeBlock(timeBlock: TimeBlock): string {
        const start = this.showEvent(this._logs.getEventById(timeBlock.startId)!)
        const end = this.showEvent(this._logs.getEventById(timeBlock.endId)!)
        const note = timeBlock.note ? `\n  📝 ${timeBlock.note}` : ''
        return `🔷 ${timeBlock.name}\n  开始: ${start}\n  结束: ${end}${note}`
    }

    private async ask(question: string): Promise<string> {
        return new Promise((resolve) => {
            this.rl.question(question, (answer) => {
                resolve(answer);
            });
        });
    }

    private async confirm(question: string): Promise<boolean> {
        const answer = await this.ask(question);
        return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
    }

    private printSuccess(message: string): void {
        console.log(color(COLORS.green, message));
    }

    private printError(message: string): void {
        console.log(color(COLORS.red, message));
    }

    private printBlockInfo(message: string): void {
        console.log(color(COLORS.blue, message));
    }

    private printWarning(message: string): void {
        console.log(color(COLORS.yellow, message));
    }

    private getActiveBlock(): PlannedTimeBlock | undefined {
        return this.activeBlock
    }

    private getBlockDuration(block: TimeBlock): number {
        const start = this._logs.getEventById(block.startId)?.timestamp ?? 0
        const end = this._logs.getEventById(block.endId)?.timestamp ?? Date.now()
        return end - start
    }

    private async handleStartBlock(name: string): Promise<void> {
        const currentBlock = this.getActiveBlock();
        if (currentBlock) {
            const startEvent = this.activeStartEvent
            const duration = startEvent ? formatDuration(Date.now() - startEvent.timestamp) : '未知'
            this.printWarning(`⚠️  当前已有活跃时间块: ${currentBlock.name} (已进行 ${duration})`);

            const shouldEnd = await this.confirm('是否帮您结束当前块？(y/n) ');
            if (shouldEnd) {
                await this.endBlock();
            } else {
                this.printWarning('已取消新时间块的开始');
                return;
            }
        }

        await this.startBlock(name);
    }

    private async startBlock(name: string): Promise<void> {
        const tags = new Set<Tag>(['block_start'])
        const event = this._logs.addEvent(`开始时间块 "${name}"`, tags)
        this.activeBlock = new PlannedTimeBlockImpl(event.id, name, tags)

        this.printSuccess('📝 事件已记录');
        console.log(`ID: ${event.id.slice(0, 8)}...`);
        console.log(`时间: ${formatTime(event.timestamp)}`);
        console.log(`内容: 开始时间块 "${name}"`);
        console.log('');
        this.printBlockInfo(`🔷 时间块已开始: ${name}`);
    }

    private async endBlock(): Promise<boolean> {
        if (this.activeBlock === undefined) {
            this.printError('没有活跃的时间块');
            return false;
        }

        let note: NoteContent = '';
        while (note === '') {
            note = await this.ask('请输入本次时间块的记录/反思（必填）：') as NoteContent;
        }

        const start = this._logs.getEventById(this.activeBlock.startId)!
        const tags = new Set<Tag>(['block_end'])
        const end = this._logs.addEvent('结束时间块', tags)

        const block = this._logs.addTimeBlock(start, end, {
            name: this.activeBlock.name,
            note,
            tags: this.activeBlock.tags
        })

        const duration = formatDuration(this.getBlockDuration(block));

        this.printSuccess('📝 事件已记录');
        console.log(`ID: ${end.id.slice(0, 8)}...`);
        console.log(`时间: ${formatTime(end.timestamp)}`);
        console.log(`内容: 结束时间块 "${block.name}"`);
        console.log('');
        this.printBlockInfo(`🔴 时间块已结束: ${block.name}`);
        console.log(color(COLORS.blue, `   持续时间: ${duration}`));

        this.activeBlock = undefined;
        return true;
    }

    private handleNote(content: string): void {
        const event = this._logs.addEvent(content, new Set<Tag>())

        this.printSuccess('📝 事件已记录');
        console.log(`ID: ${event.id.slice(0, 8)}...`);
        console.log(`时间: ${formatTime(event.timestamp)}`);
        console.log(`内容: ${content}`);
    }

    private printBlockDetails(block: TimeBlock): void {
        const duration = this.getBlockDuration(block);
        const durationStr = formatDuration(duration);
        const longTag = duration > 4 * 60 * 60 * 1000 ? color(COLORS.red, ` 🔴 已进行 ${formatDuration(duration)}`) : '';
        const events = [...this._logs.eventsInBlock(block)];
        const eventCount = events.length;

        this.printBlockInfo(`🔷 ${block.name} | 已记录 ${eventCount} 条 | 持续 ${durationStr}${longTag}`);

        for (const event of events) {
            const icon = event.tags.has('block_start') ? '🔷' : event.tags.has('block_end') ? '🔴' : '📝';
            const indent = '    ';
            console.log(`${indent}${icon} ${formatTime(event.timestamp)} ${event.content}`);
        }

        if (block.note) {
            console.log(color(COLORS.green, `    📝 ${block.note}`));
        }

        const endEvent = this._logs.getEventById(block.endId);
        if (endEvent) {
            console.log(color(COLORS.green, '    ✅ 已完成'));
        }
        console.log('');
    }

    private printRecentBlocks(): void {
        const blocks = [...this._logs.timeBlocks];
        if (blocks.length === 0) {
            console.log('暂无时间块记录');
            return;
        }

        const recentBlocks = blocks.slice(-10);

        console.log('--- 最近时间块 ---');
        console.log('');

        for (const block of recentBlocks) {
            this.printBlockDetails(block);
        }
    }

    private printCurrentStatus(): void {
        const currentBlock = this.getActiveBlock();
        if (currentBlock) {
            const startEvent = this.activeStartEvent;
            const duration = startEvent ? formatDuration(Date.now() - startEvent.timestamp) : '未知';
            const longTag = startEvent && (Date.now() - startEvent.timestamp) > 4 * 60 * 60 * 1000
                ? color(COLORS.red, ` 🔴 已进行 ${duration}`)
                : '';
            console.log(color(COLORS.blue, `\n当前状态: 活跃时间块 "${currentBlock.name}" (${duration})${longTag}`));
        }
    }

    private getPrompt(): string {
        const currentBlock = this.getActiveBlock();
        if (currentBlock) {
            return color(COLORS.blue, `[${currentBlock.name}] > `);
        }
        return color(COLORS.blue, '> ');
    }

    private saveData(): void {
        const dir = path.dirname(this.dataFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.dataFile, JSON.stringify(this.toJSON(), null, 2));
    }

    private async resetData(): Promise<void> {
        this.printWarning('⚠️  警告: 重置将清除所有数据，此操作不可撤销！');
        const confirm = await this.ask('请输入 "RESET" 确认重置: ');
        if (confirm === 'RESET') {
            this.logs.loadJSON({ events: [], timeBlocks: [] } as JSONValue);
            this.activeBlock = undefined;
            this.printSuccess('数据已重置');
        } else {
            this.printWarning('重置已取消');
        }
    }

    private async handleError(error: Error): Promise<void> {
        this.printError(`错误: ${error.message}`);
        console.log('');

        const choice = await this.ask('请选择: (1) 退出 (2) 重置数据: ');
        if (choice === '2') {
            await this.resetData();
        } else {
            this.printWarning('正在退出...');
            this.exit();
        }
    }

    private async handleInput(input: string): Promise<boolean> {
        const trimmed = input.trim();

        if (!trimmed) {
            return true;
        }

        const lower = trimmed.toLowerCase();
        if (lower === 'exit' || lower === 'quit' || lower === 'q' || lower === '/exit' || lower === '/quit' || lower === '/q') {
            this.saveData();
            console.log(color(COLORS.green, '💾 数据已保存到 data/exomind.json'));
            console.log(color(COLORS.blue, '再见！'));
            this.exit();
            return false;
        }

        if (trimmed.startsWith('开始')) {
            const name = trimmed.slice(2).trim();
            if (!name) {
                this.printError('请输入时间块名称，例如: 开始写代码');
                return true;
            }
            await this.handleStartBlock(name);
            return true;
        }

        if (trimmed === '结束') {
            await this.endBlock();
            return true;
        }

        this.handleNote(trimmed);
        return true;
    }

    private exit(): void {
        this.rl.close();
        process.exit(0);
    }

    toJSON(): JSONValue {
        return {
            events: [...this._logs.events].map(e => e.toJSON()),
            timeBlocks: [...this._logs.timeBlocks].map(tb => tb.toJSON()),
            activeBlock: this.activeBlock?.toJSON()
        } as JSONValue
    }

    loadJSON(json: JSONValue): void {
        this._logs.loadJSON(json);

        const data = json as JSONObject
        if (typeof data.activeBlock === 'object' && data.activeBlock !== null) {
            this.activeBlock = PlannedTimeBlockImpl.fromJSON(data.activeBlock as JSONObject)
        }
    }

    async run(): Promise<void> {
        console.log(color(COLORS.green, 'ExoMind v1.1 - 外心 MVP - 记录生命中的每一个事件'));
        console.log(color(COLORS.blue, '(Ctrl+D 发送，exit 退出)'));
        console.log('');

        try {
            if (fs.existsSync(this.dataFile)) {
                const content = fs.readFileSync(this.dataFile, 'utf-8');
                if (content.trim()) {
                    this.loadJSON(JSON.parse(content));
                }
            }

            const eventCount = [...this._logs.events].length;
            const blockCount = [...this._logs.timeBlocks].length;
            console.log(color(COLORS.blue, `📁 已加载 ${eventCount} 条事件，${blockCount} 个时间块`));
            console.log('');

            this.printCurrentStatus();
            this.printRecentBlocks();

            const loop = async () => {
                try {
                    const input = await this.ask(this.getPrompt());
                    const shouldContinue = await this.handleInput(input);
                    if (shouldContinue) {
                        loop();
                    }
                } catch (error) {
                    if (error instanceof Error && error.message.includes('readline')) {
                        this.saveData();
                        this.exit();
                    } else {
                        await this.handleError(error as Error);
                    }
                }
            };

            loop();
        } catch (error) {
            await this.handleError(error as Error);
        }
    }
}

// ============ 启动 ============

const app = new ExoMindAppImpl();
app.run();
