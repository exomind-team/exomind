// 基础数据类型的定义，可扩展 //

/**
 * JSON值
 * * 📍可序列化性：保证能转换为JSON字符串
 */
export type JSONValue = string | number | boolean | null | JSONObject | JSONArray;

/**
 * JSON对象，包括一系列JSON键值对
 * * 📍可序列化性：保证能转换为JSON字符串
 */
export interface JSONObject { [key: string]: JSONValue; }

/**
 * JSON数组，包括一系列JSON值
 * * 📍可序列化性：保证能转换为JSON字符串
 */
export interface JSONArray extends Array<JSONValue> { }

/**
 * id类型
 * * 📍性质：唯一性，不重复
 * * 📌【2026-02-07 10:25:32】目前用UUID即可
 * * 💡扩展性：后续可使用其他类型，如自增ID
 */
export type UUID = string

/**
 * 时间戳类型
 * * 📌【2026-02-07 10:25:59】目前用unix timestamp ms，保证为整数
 * * 💡扩展性：后续可使用其他类型，如ISO8601
 */
export type Timestamp = number

/**
 * 记录内容类型
 * * 📌【2026-02-07 10:26:09】目前用字符串即可
 * * 💡扩展性：后续可用富文本类型，可参考Jupyter「Markdown+附件」的配置
 * * 📍通用性：事件日志、时间块都使用该内容，作为通用呈现方式
 */
export type NoteContent = string

/**
 * 标签类型
 * * 📌【2026-02-07 10:26:17】目前用字符串即可
 */
export type Tag = string

// 外心底层数据结构 //

/**
 * 外心 事件日志中的一个事件
 * * 📍唯一性：每个事件都有唯一一个ID值，不重复，可供外部以 `唯一值 | 空` 的方式获取
 *   * 💭【2026-02-07 10:45:55】「世界上没有两个id完全相同的事件」
 * * 📍瞬时性：一个事件只发生在一个时间点上，表现为「用户记录一条消息」
 * * 📍内容性：一个事件会包含若干内容，包括但不限于文本、链接、富文本（Markdown）、图片、文件等等
 *   * 📌【2026-02-07 10:39:04】MVP阶段：先有纯文本，再扩展其他
 * * 📍主题性：包含若干「标签」以便根据宏观的、主题性的需求进行筛选过滤
 * * 📍扩展性：可带有若干「元数据」，以便随时扩展
 *   * 📌元数据可序列化性：保证能转换为JSON字符串并完整传递
 *   * 🚩这些「元数据」能在后续「转正」成为事件日志自身的属性
 *     * 📄如「附件」可在后续独立出一个`attachments: { [id: string]: Attachment }`字段
 */
export interface Event {
    // 📍唯一性 //
    /** 事件ID，有唯一性，不重复 */
    readonly id: UUID

    // 📍瞬时性 //
    /** 发生时间，unix ms */
    readonly timestamp: Timestamp

    // 📍内容性 //
    /** 内容 */
    get content(): NoteContent

    // 📍主题性 //
    /** 标签，默认为空，不重复 */
    get tags(): Set<Tag>

    // 📍扩展性 //
    /**
     * 元数据（可选）
     * * 📍可序列化性：保证能转换为JSON字符串并完整传递
     */
    get meta(): JSONObject | void

    // 📍可序列化 //
    toJSON(): JSONObject
}

/**
 * 外心 时间块日志中的一个时间块
 * * 📍唯一性：同`Event`，每个时间块都有唯一一个ID值，不重复，可供外部以 `唯一值 | 空` 的方式获取
 * * 📍内容性：时间块本身包含层次比事件更高的一些内容
 *   * 📌名称：时间块的名字，概括这一段时间主要做的内容
 *   * 📌个人记录：时间块创建（完成）后，用户记录的内容，包括但不限于自我反馈、状态变化、过程笔记等等
 * * 📍主题性：包含若干「标签」以便根据宏观的、主题性的需求进行筛选过滤
 *   * 📌标签不重复，以迭代的方式（不要求迭代顺序）被获取
 *   * ❓【2026-02-07 10:32:24】有待商讨：事件带标签，时间块是否也要随之带标签
 *     * ❓带标签的作用是什么？
 *     * ❓是否需要从「头尾事件」中提取标签？
 * * 📍连续性：从一个事件开始，从另一个事件结束，表现为一系列事件的集合
 *   * 📌延伸「可重叠性」：不同时间块允许重叠（包含相同的事件），只是端点（事件）固定
 * * 📍扩展性：可带有若干「元数据」，以便随时扩展
 */
export interface TimeBlock {
    // 📍唯一性 //
    /** 时间块ID，有唯一性，不重复 */
    readonly id: UUID

    // 📍内容性 //
    /** 名称，概括这一段时间主要做的内容 */
    readonly name: string

    /** 个人记录，时间块创建（完成）后，用户记录的内容，包括但不限于自我反馈、状态变化、过程笔记等等 */
    get note(): NoteContent

    // 📍主题性 //
    /**
     * 标签，不重复
     * @default 默认为空
     */
    get tags(): Set<Tag>

    // 📍连续性 //

    /**
     * 开始的事件ID
     * * 📌【2026-02-07 14:54:09】设计上的妥协：不嵌套存储数据，只存储其唯一性引用
     * * 📍【2026-02-07 14:54:29】绕过「上下文」问题：只在上下文充足的结构中定义存取方法
     */
    readonly startId: UUID
    /**
     * 结束的事件ID
     * * 📌【2026-02-07 14:54:09】设计上的妥协：不嵌套存储数据，只存储其唯一性引用
     * * 📍【2026-02-07 14:54:29】绕过「上下文」问题：只在上下文充足的结构中定义存取方法
     */
    readonly endId: UUID

    // 📍扩展性  //

    /**
     * 元数据（可选）
     * * 📍可序列化性：保证能转换为JSON字符串并完整传递
     * @returns 元数据（可能没有）
     */
    get meta(): JSONObject | void

    // 📍可序列化 //
    toJSON(): JSONObject
}

/**
 * 计划中时间块（只有开始，没有结束）
 * * 用于跟踪活跃时间块
 * * 📌【2026-02-07 18:41:36】ID 只有在创建 TimeBlock 时才生成
 */
export interface PlannedTimeBlock {
    /** 开始事件ID */
    readonly startId: UUID
    /** 时间块名称 */
    readonly name: string
    /** 标签 */
    get tags(): Set<Tag>
    /** 元数据 */
    get meta(): JSONObject | void

    // 📍可序列化 //
    toJSON(): JSONObject
}

// 外心具体业务层 //

/**
 * 外心日志系统
 * * 📍事件日志：底层的「事件日志」，存储用户输入的事件
 * * 📍时间块日志：构架在「事件日志」之上的「时间块日志」
 * * 📍可存取性：能通过JSON方式被保存/加载
 *   * 📌【2026-02-07 11:21:11】可在自身基础上载入/导出JSON
 */
export interface ExoMindLogs {
    // 📍事件日志 //
    /**
     * 不制约顺序地获取所有事件
     * * 💡【2026-02-07 10:57:17】底层实现可以是Map、Set、数组等等
     * @returns 迭代器
     */
    get events(): IterableIterator<Event>

    /**
     * 按照时间顺序遍历所有事件
     * @returns 迭代器
     */
    get eventsByTime(): IterableIterator<Event>

    /**
     * 根据ID获取事件
     * @returns 可能为空（事件不存在）
     */
    getEventById(id: UUID): Event | void

    /**
     * 添加事件
     * * 📌根据参数添加，自动生成ID与时间戳
     * @param content 事件内容
     * @param tags 标签
     * @param meta （可选）元数据
     * @returns 添加后的事件
     */
    addEvent(content: NoteContent, tags: Set<Tag>, meta?: JSONObject): Event

    // 📍时间块日志 //

    /**
     * 从头到尾获取时间块日志中所有的事件
     * * 📌包括头尾
     * * ❓【2026-02-07 10:34:49】上下文问题：实际编程中，如何「根据UUID获取事件」？所需的信息从何而来？（具体技术细节）
     *   * 📍【2026-02-07 14:54:29】绕过「上下文」问题：只在上下文充足的结构中定义存取方法，只提供一种实现方法，而非为语法方便增加多种快捷方式
     *     * 🎯目的：减少Agent幻觉
     */
    eventsInBlock(timeBlock: TimeBlock): IterableIterator<Event>

    /**
     * 获取所有时间块
     * @returns 迭代器
     */
    get timeBlocks(): IterableIterator<TimeBlock>

    /**
     * 根据开始时间顺序获取时间块
     * @returns 迭代器
     */
    get timeBlocksByStartTime(): IterableIterator<TimeBlock>

    /**
     * 根据结束时间顺序获取时间块
     * * ℹ️【2026-02-07 11:12:25】在不考虑重叠的情况下，效果往往与`timeBlocksByStartTime`一致
     * @returns 迭代器
     */
    get timeBlocksByEndTime(): IterableIterator<TimeBlock>

    /**
     * 根据ID获取时间块
     * @param id 时间块ID
     * @returns 可能为空（时间块不存在）
     */
    getTimeBlockById(id: UUID): TimeBlock | void

    /**
     * 添加时间块：将两个事件连缀形成时间块
     * @param start 开始事件
     * @param end 结束事件
     * @param context 具体上下文，定义时间块的独有属性
     */
    addTimeBlock(start: Event, end: Event, context: {
        name: string,
        note: NoteContent,
        tags: Set<Tag>,
        meta?: JSONObject,
    }): TimeBlock

    // 📍可存取性 //

    /**
     * 将日志系统保存为JSON值
     * @returns JSON值
     */
    toJSON(): JSONValue

    /**
     * 从JSON值加载到日志系统
     * * 📌【2026-02-07 11:22:31】在实际实现中，先加载一个空的日志系统，然后调用此方法
     * @param json JSON值
     */
    loadJSON(json: JSONValue): void
}

/**
 * 外心APP
 * * 📍日志系统：能记录并获取日志
 * * 📍时间块连缀系统
 *   * 📌缓存当前活跃的「开始事件」，以记录「时间块开始」并在「时间块结束」后连缀形成时间块
 *   * 💭【2026-02-07 11:25:06】讨论避坑：「同一时间只能有一个活跃时间块；超过 4 小时未结束自动标记异常；重新打开时如果有未结束的块，弹窗提醒。」
 *   * 📌判断一个时间块是否为「开始时间块」：用于自动开启「时间块记录」
 *   * 📌判断一个时间块是否为「结束时间块」：用于自动结束「时间块记录」
 *   * 📌用「当前活跃开始事件」连缀时间块
 * * 📍展示呈现系统：呈现事件日志，时间块日志
 *   * 📌【2026-02-07 11:33:55】目前不限制输出逻辑——默认就输出为字符串
 *   * 💡【2026-02-07 11:38:40】后续的输出逻辑可以扩展，如富文本、带附件字符串等
 * * 📍可存取性：能通过JSON方式被保存/加载
 */
export interface ExoMindApp {
    /** 日志系统 */
    get logs(): ExoMindLogs

    // 📍时间块连缀系统 //
    /** 当前活跃时间块 */
    get activeStartEvent(): Event | void

    /**
     * 判断一个事件是否为「开始时间块」
     * @param event 事件
     * @returns 是否为「开始时间块」
     */
    isStartEvent(event: Event): boolean

    /**
     * 判断一个事件是否为「结束时间块」
     * @param event 事件
     * @returns 是否为「结束时间块」
     */
    isEndEvent(event: Event): boolean

    /**
     * 添加时间块：将两个事件连缀形成时间块
     * * 📌【2026-02-07 11:26:05】如果当前有活跃时间块，则自动结束该时间块
     * @param end 结束事件
     * @param context 具体上下文，定义时间块的独有属性
     */
    addTimeBlock(end: Event, context: {
        tags: Set<Tag>,
        meta?: JSONObject,
    }): TimeBlock

    // 📍展示呈现系统 //
    /**
     * 呈现一个事件
     * @param event 事件
     * @returns {string} 呈现结果
     */
    showEvent(event: Event): string

    /**
     * 呈现一个时间块
     * @param timeBlock 时间块
     * @returns {string} 呈现结果
     */
    showTimeBlock(timeBlock: TimeBlock): string

    // 📍可存取性 //
    /**
     * 将APP数据保存为JSON值
     * @returns JSON值
     */
    toJSON(): JSONValue

    /**
     * 从JSON值加载到APP数据
     * * 📌【2026-02-07 11:22:31】在实际实现中，先加载一个空的APP，然后调用此方法载入数据
     * @param json JSON值
     */
    loadJSON(json: JSONValue): void
}
