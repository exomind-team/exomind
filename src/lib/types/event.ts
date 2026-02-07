/**
 * Unified Event Types - ExoMind 事件类型定义
 *
 * 统一的 Event, TimeBlock, PlannedTimeBlock 接口定义
 *
 * 设计原则:
 * - 唯一性：每个事件/时间块都有唯一的 UUID
 * - 瞬时性：事件记录一个时间点
 * - 连续性：时间块由开始/结束事件定义范围
 * - 可序列化：所有类型都能转换为 JSON
 */

// ============== 基础类型 ==============

/**
 * JSON 值类型
 * - 可序列化性：保证能转换为 JSON 字符串
 */
export type JSONValue = string | number | boolean | null | JSONObject | JSONArray;

/**
 * JSON 对象
 * - 可序列化性：保证能转换为 JSON 字符串
 */
export interface JSONObject {
  [key: string]: JSONValue;
}

/**
 * JSON 数组
 * - 可序列化性：保证能转换为 JSON 字符串
 */
export interface JSONArray extends Array<JSONValue> {}

/**
 * UUID 类型
 * - 性质：唯一性，不重复
 * - 扩展性：后续可使用其他类型，如自增 ID
 */
export type UUID = string;

/**
 * 时间戳类型
 * - 使用 Unix timestamp ms，保证为整数
 * - 扩展性：后续可使用其他类型，如 ISO8601
 */
export type Timestamp = number;

/**
 * 记录内容类型
 * - 使用字符串即可
 * - 扩展性：后续可用富文本类型
 * - 通用性：事件日志、时间块都使用该内容
 */
export type NoteContent = string;

/**
 * 标签类型
 * - 使用字符串即可
 */
export type Tag = string;

// ============== Event 接口 ==============

/**
 * ExoMind 事件日志中的一个事件
 *
 * 特性:
 * - 唯一性：每个事件都有唯一的 ID
 * - 瞬时性：一个事件只发生在一个时间点上
 * - 内容性：包含文本内容、链接、富文本、图片等
 * - 主题性：包含标签以便筛选过滤
 * - 扩展性：可带有元数据
 */
export interface Event {
  /** 事件 ID，有唯一性，不重复 */
  readonly id: UUID;

  /** 发生时间，Unix ms */
  readonly timestamp: Timestamp;

  /** 内容 */
  get content(): NoteContent;

  /** 标签，默认为空，不重复 */
  get tags(): Set<Tag>;

  /** 元数据（可选）- 可序列化 */
  get meta(): JSONObject | void;

  /** 转换为 JSON 对象 */
  toJSON(): JSONObject;
}

// ============== TimeBlock 接口 ==============

/**
 * ExoMind 时间块日志中的一个时间块
 *
 * 特性:
 * - 唯一性：每个时间块都有唯一的 ID
 * - 内容性：包含名称和个人记录
 * - 主题性：包含标签以便筛选过滤
 * - 连续性：从开始事件到结束事件
 * - 扩展性：可带有元数据
 */
export interface TimeBlock {
  /** 时间块 ID，有唯一性，不重复 */
  readonly id: UUID;

  /** 名称，概括这一段时间主要做的内容 */
  readonly name: string;

  /** 个人记录，时间块完成后用户记录的内容 */
  get note(): NoteContent;

  /** 标签，不重复 */
  get tags(): Set<Tag>;

  /** 开始事件 ID（引用） */
  readonly startId: UUID;

  /** 结束事件 ID（引用） */
  readonly endId: UUID;

  /** 元数据（可选）- 可序列化 */
  get meta(): JSONObject | void;

  /** 转换为 JSON 对象 */
  toJSON(): JSONObject;
}

// ============== PlannedTimeBlock 接口 ==============

/**
 * 计划中时间块（只有开始，没有结束）
 *
 * 用途：跟踪当前活跃但未结束的时间块
 * - ID 只有在创建 TimeBlock 时才生成
 */
export interface PlannedTimeBlock {
  /** 开始事件 ID */
  readonly startId: UUID;

  /** 时间块名称 */
  readonly name: string;

  /** 标签 */
  get tags(): Set<Tag>;

  /** 元数据 */
  get meta(): JSONObject | void;

  /** 转换为 JSON 对象 */
  toJSON(): JSONObject;
}

// ============== ExoMindLogs 接口 ==============

/**
 * ExoMind 日志系统
 *
 * 功能:
 * - 事件日志：底层的「事件日志」，存储用户输入的事件
 * - 时间块日志：构架在「事件日志」之上的「时间块日志」
 * - 可存取性：能通过 JSON 方式被保存/加载
 */
export interface ExoMindLogs {
  // --- 事件日志 ---

  /** 不制约顺序地获取所有事件 */
  get events(): IterableIterator<Event>;

  /** 按照时间顺序遍历所有事件 */
  get eventsByTime(): IterableIterator<Event>;

  /** 根据 ID 获取事件 */
  getEventById(id: UUID): Event | void;

  /**
   * 添加事件
   * - 根据参数添加，自动生成 ID 与时间戳
   * @param content 事件内容
   * @param tags 标签
   * @param meta （可选）元数据
   * @returns 添加后的事件
   */
  addEvent(content: NoteContent, tags: Set<Tag>, meta?: JSONObject): Event;

  // --- 时间块日志 ---

  /**
   * 获取时间块内所有事件（包括头尾）
   * @param timeBlock 时间块
   * @returns 事件迭代器
   */
  eventsInBlock(timeBlock: TimeBlock): IterableIterator<Event>;

  /** 获取所有时间块 */
  get timeBlocks(): IterableIterator<TimeBlock>;

  /** 按照开始时间顺序获取时间块 */
  get timeBlocksByStartTime(): IterableIterator<TimeBlock>;

  /** 按照结束时间顺序获取时间块 */
  get timeBlocksByEndTime(): IterableIterator<TimeBlock>;

  /** 根据 ID 获取时间块 */
  getTimeBlockById(id: UUID): TimeBlock | void;

  /**
   * 添加时间块：将两个事件连缀形成时间块
   * @param start 开始事件
   * @param end 结束事件
   * @param context 具体上下文
   */
  addTimeBlock(
    start: Event,
    end: Event,
    context: {
      name: string;
      note: NoteContent;
      tags: Set<Tag>;
      meta?: JSONObject;
    }
  ): TimeBlock;

  // --- 可存取性 ---

  /** 将日志系统保存为 JSON 值 */
  toJSON(): JSONValue;

  /** 从 JSON 值加载到日志系统 */
  loadJSON(json: JSONValue): void;
}

// ============== ExoMindApp 接口 ==============

/**
 * ExoMind 应用主接口
 *
 * 功能:
 * - 日志系统：能记录并获取日志
 * - 时间块连缀系统：管理活跃时间块
 * - 展示呈现系统：呈现事件和时间块
 * - 可存取性：能通过 JSON 方式被保存/加载
 */
export interface ExoMindApp {
  /** 日志系统 */
  get logs(): ExoMindLogs;

  // --- 时间块连缀系统 ---

  /** 当前活跃时间块 */
  get activeStartEvent(): Event | void;

  /**
   * 判断一个事件是否为「开始事件」
   * @param event 事件
   * @returns 是否为开始事件
   */
  isStartEvent(event: Event): boolean;

  /**
   * 判断一个事件是否为「结束事件」
   * @param event 事件
   * @returns 是否为结束事件
   */
  isEndEvent(event: Event): boolean;

  /**
   * 添加时间块：将两个事件连缀形成时间块
   * - 如果当前有活跃时间块，则自动结束该时间块
   * @param end 结束事件
   * @param context 具体上下文
   */
  addTimeBlock(
    end: Event,
    context: {
      tags: Set<Tag>;
      meta?: JSONObject;
    }
  ): TimeBlock;

  // --- 展示呈现系统 ---

  /**
   * 呈现一个事件
   * @param event 事件
   * @returns 呈现结果字符串
   */
  showEvent(event: Event): string;

  /**
   * 呈现一个时间块
   * @param timeBlock 时间块
   * @returns 呈现结果字符串
   */
  showTimeBlock(timeBlock: TimeBlock): string;

  // --- 可存取性 ---

  /** 将 APP 数据保存为 JSON 值 */
  toJSON(): JSONValue;

  /** 从 JSON 值加载到 APP 数据 */
  loadJSON(json: JSONValue): void;
}

// ============== 事件工厂函数 ==============

/**
 * 事件创建选项
 */
export interface CreateEventOptions {
  content: NoteContent;
  tags?: Set<Tag>;
  meta?: JSONObject;
}

/**
 * 时间块创建选项
 */
export interface CreateTimeBlockOptions {
  name: string;
  note?: NoteContent;
  tags?: Set<Tag>;
  meta?: JSONObject;
}

/**
 * 快速创建事件
 */
export interface EventFactory {
  /** 创建新事件 */
  create(options: CreateEventOptions): Event;

  /** 从 JSON 恢复事件 */
  fromJSON(json: JSONObject): Event;
}

/**
 * 时间块工厂
 */
export interface TimeBlockFactory {
  /** 从 JSON 恢复时间块（需要开始和结束事件） */
  fromJSON(json: JSONObject, start: Event, end: Event): TimeBlock;
}

// ============== 事件过滤器 ==============

/**
 * 事件过滤条件
 */
export interface EventFilter {
  /** 按标签过滤 */
  tags?: Set<Tag>;

  /** 按时间范围过滤 */
  timeRange?: {
    start: Timestamp;
    end: Timestamp;
  };

  /** 按内容关键字过滤 */
  keyword?: string;
}

/**
 * 时间块过滤条件
 */
export interface TimeBlockFilter {
  /** 按标签过滤 */
  tags?: Set<Tag>;

  /** 按时间范围过滤 */
  timeRange?: {
    start: Timestamp;
    end: Timestamp;
  };

  /** 按名称关键字过滤 */
  keyword?: string;
}

// ============== 事件/时间块标签常量 ==============

/**
 * 系统标签
 */
export const SYSTEM_TAGS = {
  /** 开始时间块标签 */
  BLOCK_START: 'block_start' as Tag,

  /** 结束时间块标签 */
  BLOCK_END: 'block_end' as Tag,

  /** 普通事件标签 */
  NOTE: 'note' as Tag,
} as const;

// ============== 序列化/反序列化 ==============

/**
 * JSON 序列化格式
 */
export interface ExoMindJSON {
  events: JSONObject[];
  timeBlocks: JSONObject[];
  activeBlock: JSONObject | null;
}

/**
 * 从 JSON 加载日志系统数据
 */
export function loadLogsFromJSON(
  logs: ExoMindLogs,
  json: JSONValue
): void {
  if (typeof json !== 'object' || json === null) return;
  logs.loadJSON(json);
}

/**
 * 将日志系统保存为 JSON
 */
export function saveLogsToJSON(logs: ExoMindLogs): JSONValue {
  return logs.toJSON();
}
