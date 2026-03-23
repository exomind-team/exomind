/**
 * ExoMind MVP 单元测试
 * 测试 Event, TimeBlock, ExoMindLogs 核心功能
 */

import { randomUUID } from 'node:crypto';
import {
    Event,
    TimeBlock,
    ExoMindLogs,
    UUID,
    Timestamp,
    NoteContent,
    Tag,
    JSONObject,
    JSONValue
} from './types';

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
                    const tags = new Set<Tag>()
                    if (Array.isArray(obj.tags)) {
                        for (const t of obj.tags) {
                            if (typeof t === 'string') tags.add(t)
                        }
                    }
                    const name = typeof obj.name === 'string' ? obj.name : '未命名时间块'
                    const note = typeof obj.note === 'string' ? obj.note : '' as NoteContent
                    const block = new TimeBlockImpl(start, end, name, note, tags, obj.meta as JSONObject | undefined)
                    // Preserve the original ID from JSON
                    if (obj.id && typeof obj.id === 'string') {
                        block.id = obj.id as UUID
                    }
                    this.timeBlocksMap.set(block.id, block)
                }
            }
        }
    }
}

// ============ 测试工具 ============

let passed = 0
let failed = 0

function test(name: string, fn: () => void | Promise<void>): void {
    try {
        const result = fn()
        if (result instanceof Promise) {
            result.then(() => {
                console.log(`✓ ${name}`)
                passed++
            }).catch((e) => {
                console.log(`✗ ${name}`)
                console.log(`  Error: ${e}`)
                failed++
            })
        } else {
            console.log(`✓ ${name}`)
            passed++
        }
    } catch (e) {
        console.log(`✗ ${name}`)
        console.log(`  Error: ${e}`)
        failed++
    }
}

function assert(condition: boolean, message: string = 'Assertion failed'): void {
    if (!condition) {
        throw new Error(message)
    }
}

function assertEqual(actual: unknown, expected: unknown, message: string = ''): void {
    if (actual !== expected) {
        throw new Error(`${message} Expected ${expected}, got ${actual}`)
    }
}

// ============ Event Tests ============

console.log('\n=== Event Tests ===\n')

test('Event: should create event with content', () => {
    const event = new EventImpl('测试内容')
    assertEqual(event.content, '测试内容')
})

test('Event: should create event with tags', () => {
    const tags = new Set<Tag>(['tag1', 'tag2'])
    const event = new EventImpl('测试内容', tags)
    assert(event.tags.has('tag1'))
    assert(event.tags.has('tag2'))
    assertEqual(event.tags.size, 2)
})

test('Event: should create event with metadata', () => {
    const meta: JSONObject = { key: 'value' }
    const event = new EventImpl('测试内容', new Set(), meta)
    assertEqual(event.meta, meta)
})

test('Event: should generate unique ID', () => {
    const event1 = new EventImpl('内容1')
    const event2 = new EventImpl('内容2')
    assert(event1.id !== event2.id)
})

test('Event: should generate timestamp', () => {
    const before = Date.now()
    const event = new EventImpl('测试')
    const after = Date.now()
    assert(event.timestamp >= before && event.timestamp <= after)
})

test('Event: should serialize to JSON', () => {
    const tags = new Set<Tag>(['work', 'urgent'])
    const meta: JSONObject = { priority: 1 }
    const event = new EventImpl('完成重要任务', tags, meta)

    const json = event.toJSON()

    assertEqual(json.id, event.id)
    assertEqual(json.timestamp, event.timestamp)
    assertEqual(json.content, '完成重要任务')
    assert(Array.isArray(json.tags))
    assert((json.tags as string[]).includes('work'))
    assert((json.tags as string[]).includes('urgent'))
    assertEqual(json.meta, meta)
})

test('Event: should deserialize from JSON', () => {
    const originalJson: JSONObject = {
        id: 'test-uuid-1234',
        timestamp: 1700000000000 as Timestamp,
        content: '反序列化测试',
        tags: ['test', 'serialization']
    }

    const event = EventImpl.fromJSON(originalJson)

    assertEqual(event.id, 'test-uuid-1234')
    assertEqual(event.timestamp, 1700000000000)
    assertEqual(event.content, '反序列化测试')
    assert(event.tags.has('test'))
    assert(event.tags.has('serialization'))
})

test('Event: should handle empty tags during deserialization', () => {
    const json: JSONObject = {
        id: 'test-uuid',
        timestamp: 1700000000000 as Timestamp,
        content: '测试',
        tags: []
    }

    const event = EventImpl.fromJSON(json)
    assertEqual(event.tags.size, 0)
})

test('Event: should handle missing tags during deserialization', () => {
    const json: JSONObject = {
        id: 'test-uuid',
        timestamp: 1700000000000 as Timestamp,
        content: '测试'
    }

    const event = EventImpl.fromJSON(json)
    assertEqual(event.tags.size, 0)
})

// ============ TimeBlock Tests ============

console.log('\n=== TimeBlock Tests ===\n')

test('TimeBlock: should create time block with events', () => {
    const startEvent = new EventImpl('开始工作', new Set(['block_start']))
    const endEvent = new EventImpl('结束工作', new Set(['block_end']))

    const block = new TimeBlockImpl(startEvent, endEvent, '工作时间', '今日总结')

    assertEqual(block.name, '工作时间')
    assertEqual(block.note, '今日总结')
    assertEqual(block.startId, startEvent.id)
    assertEqual(block.endId, endEvent.id)
})

test('TimeBlock: should create time block with tags', () => {
    const startEvent = new EventImpl('开始', new Set())
    const endEvent = new EventImpl('结束', new Set())
    const tags = new Set<Tag>(['productive', 'focus'])

    const block = new TimeBlockImpl(startEvent, endEvent, '深度工作', '', tags)

    assert(block.tags.has('productive'))
    assert(block.tags.has('focus'))
})

test('TimeBlock: should create time block with metadata', () => {
    const startEvent = new EventImpl('开始', new Set())
    const endEvent = new EventImpl('结束', new Set())
    const meta: JSONObject = { mood: 'good' }

    const block = new TimeBlockImpl(startEvent, endEvent, '会议', '', new Set(), meta)

    assertEqual(block.meta, meta)
})

test('TimeBlock: should generate unique ID', () => {
    const start1 = new EventImpl('开始1', new Set())
    const end1 = new EventImpl('结束1', new Set())
    const start2 = new EventImpl('开始2', new Set())
    const end2 = new EventImpl('结束2', new Set())

    const block1 = new TimeBlockImpl(start1, end1, '块1', '')
    const block2 = new TimeBlockImpl(start2, end2, '块2', '')

    assert(block1.id !== block2.id)
})

test('TimeBlock: should serialize to JSON', () => {
    const startEvent = new EventImpl('开始', new Set(['block_start']))
    const endEvent = new EventImpl('结束', new Set(['block_end']))
    const tags = new Set<Tag>(['test'])

    const block = new TimeBlockImpl(startEvent, endEvent, '测试块', '测试笔记', tags)

    const json = block.toJSON()

    assertEqual(json.id, block.id)
    assertEqual(json.name, '测试块')
    assertEqual(json.note, '测试笔记')
    assertEqual(json.startId, startEvent.id)
    assertEqual(json.endId, endEvent.id)
    assert(Array.isArray(json.tags))
})

// ============ ExoMindLogs Tests ============

console.log('\n=== ExoMindLogs Tests ===\n')

test('ExoMindLogs: should start with empty events', () => {
    const logs = new ExoMindLogsImpl()
    assertEqual([...logs.events].length, 0)
})

test('ExoMindLogs: should add event', () => {
    const logs = new ExoMindLogsImpl()
    const event = logs.addEvent('测试事件', new Set())

    assert(event instanceof EventImpl)
    assertEqual([...logs.events].length, 1)
})

test('ExoMindLogs: should add event with tags', () => {
    const logs = new ExoMindLogsImpl()
    const tags = new Set<Tag>(['work', 'important'])
    const event = logs.addEvent('重要事件', tags)

    assert(event.tags.has('work'))
    assert(event.tags.has('important'))
})

test('ExoMindLogs: should get event by ID', () => {
    const logs = new ExoMindLogsImpl()
    const event = logs.addEvent('测试', new Set())

    const found = logs.getEventById(event.id)

    assert(found !== undefined)
    assertEqual(found!.id, event.id)
})

test('ExoMindLogs: should return undefined for non-existent event', () => {
    const logs = new ExoMindLogsImpl()
    const found = logs.getEventById('non-existent-id')
    assertEqual(found, undefined)
})

test('ExoMindLogs: should return events by time order', () => {
    const logs = new ExoMindLogsImpl()

    // Add events in specific order with controlled timestamps
    const event2 = logs.addEvent('第二个', new Set(), { ts: 2000 })
    event2.timestamp = 2000 as Timestamp
    const event1 = logs.addEvent('第一个', new Set(), { ts: 1000 })
    event1.timestamp = 1000 as Timestamp
    const event3 = logs.addEvent('第三个', new Set(), { ts: 3000 })
    event3.timestamp = 3000 as Timestamp

    const sorted = [...logs.eventsByTime]

    assertEqual(sorted[0].id, event1.id)
    assertEqual(sorted[1].id, event2.id)
    assertEqual(sorted[2].id, event3.id)
})

test('ExoMindLogs: should add time block', () => {
    const logs = new ExoMindLogsImpl()
    const start = logs.addEvent('开始块', new Set(['block_start']))
    const end = logs.addEvent('结束块', new Set(['block_end']))

    const block = logs.addTimeBlock(start, end, {
        name: '测试时间块',
        note: '测试笔记',
        tags: new Set(['test'])
    })

    assert(block instanceof TimeBlockImpl)
    assertEqual([...logs.timeBlocks].length, 1)
})

test('ExoMindLogs: should get time blocks by start time', () => {
    const logs = new ExoMindLogsImpl()

    // Create events first with controlled timestamps
    const start1 = logs.addEvent('开始1', new Set(), { ts: 1000 })
    start1.timestamp = 1000 as Timestamp
    const end1 = logs.addEvent('结束1', new Set(), { ts: 2000 })
    end1.timestamp = 2000 as Timestamp
    const start2 = logs.addEvent('开始2', new Set(), { ts: 3000 })
    start2.timestamp = 3000 as Timestamp
    const end2 = logs.addEvent('结束2', new Set(), { ts: 4000 })
    end2.timestamp = 4000 as Timestamp

    // Add time blocks
    const block2 = logs.addTimeBlock(start2, end2, { name: '块2', note: '', tags: new Set() })
    const block1 = logs.addTimeBlock(start1, end1, { name: '块1', note: '', tags: new Set() })

    // Manually set timestamps for sorting
    const sorted = [...logs.timeBlocksByStartTime]

    assertEqual(sorted[0].name, '块1')
    assertEqual(sorted[1].name, '块2')
})

test('ExoMindLogs: should get time blocks by end time', () => {
    const logs = new ExoMindLogsImpl()

    const start1 = logs.addEvent('开始1', new Set(), { ts: 1000 })
    start1.timestamp = 1000 as Timestamp
    const end1 = logs.addEvent('结束1', new Set(), { ts: 2000 })
    end1.timestamp = 2000 as Timestamp
    const start2 = logs.addEvent('开始2', new Set(), { ts: 1500 })
    start2.timestamp = 1500 as Timestamp
    const end2 = logs.addEvent('结束2', new Set(), { ts: 2500 })
    end2.timestamp = 2500 as Timestamp

    const block2 = logs.addTimeBlock(start2, end2, { name: '块2', note: '', tags: new Set() })
    const block1 = logs.addTimeBlock(start1, end1, { name: '块1', note: '', tags: new Set() })

    const sorted = [...logs.timeBlocksByEndTime]

    assertEqual(sorted[0].name, '块1')
    assertEqual(sorted[1].name, '块2')
})

test('ExoMindLogs: should get time block by ID', () => {
    const logs = new ExoMindLogsImpl()
    const start = logs.addEvent('开始', new Set())
    const end = logs.addEvent('结束', new Set())
    const block = logs.addTimeBlock(start, end, { name: '测试', note: '', tags: new Set() })

    const found = logs.getTimeBlockById(block.id)

    assert(found !== undefined)
    assertEqual(found!.id, block.id)
})

test('ExoMindLogs: should return events in time block', () => {
    const logs = new ExoMindLogsImpl()

    // Create time block
    const start = logs.addEvent('开始', new Set(), { ts: 1000 })
    start.timestamp = 1000 as Timestamp
    const end = logs.addEvent('结束', new Set(), { ts: 5000 })
    end.timestamp = 5000 as Timestamp
    const block = logs.addTimeBlock(start, end, { name: '块', note: '', tags: new Set() })

    // Add events inside and outside the time block
    const inside1 = logs.addEvent('内部1', new Set(), { time: 2000 })
    inside1.timestamp = 2000 as Timestamp
    const inside2 = logs.addEvent('内部2', new Set(), { time: 3000 })
    inside2.timestamp = 3000 as Timestamp
    const outside = logs.addEvent('外部', new Set(), { time: 10000 })
    outside.timestamp = 10000 as Timestamp

    const eventsInBlock = [...logs.eventsInBlock(block)]

    // Should contain: start, end, inside1, inside2 (4 events)
    assertEqual(eventsInBlock.length, 4)
})

test('ExoMindLogs: should serialize to JSON', () => {
    const logs = new ExoMindLogsImpl()
    logs.addEvent('事件1', new Set(['tag1']))
    logs.addEvent('事件2', new Set(['tag2']))

    const start = logs.addEvent('开始块', new Set(), { ts: 1000 })
    start.timestamp = 1000 as Timestamp
    const end = logs.addEvent('结束块', new Set(), { ts: 2000 })
    end.timestamp = 2000 as Timestamp
    logs.addTimeBlock(start, end, { name: '块', note: '笔记', tags: new Set(['block']) })

    const json = logs.toJSON() as JSONObject

    assert(Array.isArray(json.events))
    assertEqual((json.events as JSONObject[]).length, 4) // 事件1 + 事件2 + 开始 + 结束
    assert(Array.isArray(json.timeBlocks))
    assertEqual((json.timeBlocks as JSONObject[]).length, 1)
})

test('ExoMindLogs: should load from JSON', () => {
    const logs = new ExoMindLogsImpl()

    const json: JSONValue = {
        events: [
            {
                id: 'event-1',
                timestamp: 1700000000000 as Timestamp,
                content: '加载的事件',
                tags: ['loaded']
            }
        ],
        timeBlocks: []
    }

    logs.loadJSON(json)

    assertEqual([...logs.events].length, 1)
    const event = logs.getEventById('event-1')
    assert(event !== undefined)
    assertEqual(event!.content, '加载的事件')
    assert(event!.tags.has('loaded'))
})

test('ExoMindLogs: should load time blocks from JSON', () => {
    // Create JSON with time block first
    const json: JSONValue = {
        events: [
            { id: 'start-1', timestamp: 1000 as Timestamp, content: '开始', tags: [] },
            { id: 'end-1', timestamp: 2000 as Timestamp, content: '结束', tags: [] }
        ],
        timeBlocks: [
            {
                id: 'block-1',
                name: '加载的块',
                note: '笔记',
                startId: 'start-1',
                endId: 'end-1',
                tags: ['loaded-block']
            }
        ]
    }

    // Load from JSON
    const logs = new ExoMindLogsImpl()
    logs.loadJSON(json)

    assertEqual([...logs.timeBlocks].length, 1)
    const block = logs.getTimeBlockById('block-1')
    assert(block !== undefined)
    assertEqual(block!.name, '加载的块')
})

test('ExoMindLogs: should handle empty JSON', () => {
    const logs = new ExoMindLogsImpl()
    logs.addEvent('事件', new Set())

    logs.loadJSON({ events: [], timeBlocks: [] } as JSONValue)

    assertEqual([...logs.events].length, 0)
})

test('ExoMindLogs: should handle invalid JSON gracefully', () => {
    const logs = new ExoMindLogsImpl()

    // Should not throw
    logs.loadJSON(null as unknown as JSONValue)
    logs.loadJSON('invalid' as unknown as JSONValue)
    logs.loadJSON(123 as unknown as JSONValue)

    assertEqual([...logs.events].length, 0)
})

test('ExoMindLogs: should get timeBlocks iterator', () => {
    const logs = new ExoMindLogsImpl()
    const start = logs.addEvent('开始', new Set())
    const end = logs.addEvent('结束', new Set())
    logs.addTimeBlock(start, end, { name: '块', note: '', tags: new Set() })

    const blocks = [...logs.timeBlocks]
    assertEqual(blocks.length, 1)
})

test('ExoMindLogs: should handle missing events when loading time blocks', () => {
    const logs = new ExoMindLogsImpl()

    const json: JSONValue = {
        events: [],
        timeBlocks: [
            {
                id: 'block-1',
                name: '孤立块',
                note: '',
                startId: 'missing-start',
                endId: 'missing-end',
                tags: []
            }
        ]
    }

    logs.loadJSON(json)

    // Time block should not be loaded because events are missing
    assertEqual([...logs.timeBlocks].length, 0)
})

// ============ Data Persistence Tests ============

console.log('\n=== Data Persistence Tests ===\n')

test('Persistence: should persist and reload events', () => {
    const logs1 = new ExoMindLogsImpl()
    logs1.addEvent('事件1', new Set(['tag1']))
    logs1.addEvent('事件2', new Set(['tag2', 'important']))

    // Serialize
    const json = logs1.toJSON()

    // Deserialize
    const logs2 = new ExoMindLogsImpl()
    logs2.loadJSON(json)

    // Verify
    assertEqual([...logs2.events].length, 2)
    const event1 = logs2.getEventById([...logs1.events][0].id)
    assert(event1 !== undefined)
    assert(event1!.tags.has('tag1'))
})

test('Persistence: should persist and reload time blocks', () => {
    const logs1 = new ExoMindLogsImpl()

    // Create events with controlled timestamps
    const start = logs1.addEvent('开始', new Set(), { ts: 1000 })
    start.timestamp = 1000 as Timestamp
    const end = logs1.addEvent('结束', new Set(), { ts: 2000 })
    end.timestamp = 2000 as Timestamp
    const block = logs1.addTimeBlock(start, end, {
        name: '重要会议',
        note: '讨论项目计划',
        tags: new Set(['meeting', 'planning'])
    })

    // Serialize
    const json = logs1.toJSON()

    // Deserialize to a new instance
    const logs2 = new ExoMindLogsImpl()
    logs2.loadJSON(json)

    // Verify - get events by the IDs from the first logs instance
    const loadedStart = logs2.getEventById(start.id)
    const loadedEnd = logs2.getEventById(end.id)
    assert(loadedStart !== undefined, 'Loaded start event should exist')
    assert(loadedEnd !== undefined, 'Loaded end event should exist')

    // Verify time blocks were loaded
    assertEqual([...logs2.timeBlocks].length, 1)
    const loadedBlocks = [...logs2.timeBlocks]
    const loadedBlock = loadedBlocks[0]
    assertEqual(loadedBlock.name, '重要会议')
    assertEqual(loadedBlock.note, '讨论项目计划')
    assert(loadedBlock.tags.has('meeting'))
    assert(loadedBlock.tags.has('planning'))
})

test('Persistence: should preserve event IDs across serialization', () => {
    const logs1 = new ExoMindLogsImpl()
    const event = logs1.addEvent('测试', new Set(['test']))

    const json = logs1.toJSON()
    const logs2 = new ExoMindLogsImpl()
    logs2.loadJSON(json)

    const loadedEvent = logs2.getEventById(event.id)
    assert(loadedEvent !== undefined)
    assertEqual(loadedEvent!.id, event.id)
})

// ============ Summary ============

console.log('\n=== Test Summary ===\n')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
console.log('')

if (failed > 0) {
    console.log('❌ Some tests failed!')
    process.exit(1)
} else {
    console.log('✅ All tests passed!')
    process.exit(0)
}
