/**
 * Extract - Generator 返回值提取工具
 *
 * Python 的 generator 可以通过 return 语句返回一个值：
 *   def gen():
 *       yield 1
 *       yield 2
 *       return "done"
 *
 * 但在 Python 中遍历 generator 时，return 的值会被 StopIteration 异常携带：
 *   try:
 *       for x in gen():
 *           print(x)  # 1, 2
 *   except StopIteration as e:
 *       result = e.value  # "done"
 *
 * 这个类在 TypeScript 中实现了同样的功能。
 *
 * 使用方法:
 *   const result = new Extract(generator).collect();
 *   console.log(result.generated);  // 所有 yield 的值
 *   console.log(result.returns);    // return 的值
 */

/**
 * 从 generator 提取返回值的结果
 */
export interface ExtractResult<T, R> {
    /** 所有通过 yield 产生的值 */
    generated: T[];
    /** generator return 的值 */
    returns: R;
}

/** 唯一表达式，表示「没有值」 */
const NONE = Symbol("NONE");

/**
 * 从 Generator 中提取返回值
 *
 * 🎯 核心功能：`for` 循环与迭代器返回值获取两不误
 *
 * @example
 * ```typescript
 * function* gen(): Generator<number, string> {
 *   yield 1;
 *   yield 2;
 *   yield 3;
 *   return 'done';
 * }
 *
 * // extract once
 * console.log(extract(gen()).collect()); // { generated: [1, 2, 3], returns: 'done' }
 *
 * // extract with iterating
 * const e = extract(gen());
 * for (const x of e) {
 *   console.log(x); // 1, 2, 3
 * }
 * console.log(e.returns); // 'done'
 * ```
 *
 * -----------
 *
 * ## 🔑 巧妙之处：`for` 循环 + 返回值两不误
 *
 * ### 普通情况：返回值被"偷走"
 * ```typescript
 * for (const x of gen()) {
 *   console.log(x); // 1, 2, 3
 * }
 * // "done" 丢失了 ❌
 * ```
 *
 * ### `extract` 情况：返回值被"偷出来"
 * ```typescript
 * const e = extract(gen());
 * for (const x of e) {
 *   console.log(x); // 1, 2, 3
 * }
 * console.log(e.returns); // 'done' 还在！✅
 * ```
 *
 * -----------
 *
 * ## 💡 这个模式的价值
 *
 * | 模式 | yield 值 | return 值 |
 * |------|----------|-----------|
 * | 普通 `for` | ✅ 拿到 | ❌ 丢失 |
 * | `next()` 单独调用 | ✅ 拿到 | ❌ 异常终止 |
 * | **`extract` + `for`** | ✅ 拿到 | ✅ 保留 |
 *
 * 这意味着你可以**像普通迭代器一样用**，同时**像普通函数一样拿返回值**。
 *
 * @typeParam Element - yield 的值的类型
 * @typeParam Returns - return 的值的类型
 */
export class Extract<Element, Returns> implements Iterable<Element> {
    /** 原始生成器 */
    private readonly _generator: Generator<Element, Returns, unknown>;

    /** 已生成的值 */
    private readonly _generated: Element[] = [];

    /** 存储的返回值 */
    private _returns: Returns | typeof NONE = NONE;

    /** 生成器是否已结束 */
    private _done = false;

    /**
     * 获取返回值
     * @returns 返回值，如果不存在则返回 undefined
     */
    get returns(): Returns | undefined {
        if (this._done) {
            return this._returns as Returns;
        }
        return undefined;
    }

    /** 已生成的值数量 */
    get length(): number {
        return this._generated.length;
    }

    /**
     * @param generator - 要从中提取返回值的生成器
     */
    constructor(generator: Generator<Element, Returns, unknown>) {
        this._generator = generator;
    }

    /**
     * 实现 Iterable 接口，支持 for...of 遍历
     */
    [Symbol.iterator](): Iterator<Element, Returns, unknown> {
        return {
            next: (): IteratorResult<Element, Returns> => {
                const result = this._generator.next();
                if (result.done) {
                    this._done = true;
                    // 捕获返回值
                    if (this._returns === NONE && result.value !== undefined) {
                        this._returns = result.value;
                    }
                    return { done: true, value: result.value as Returns };
                }
                this._generated.push(result.value);
                return { done: false, value: result.value };
            },
        };
    }

    /**
     * 生成所有值并返回
     * @returns [所有生成的值, 返回值]
     */
    generateAll(): ExtractResult<Element, Returns> {
        let result: IteratorResult<Element, Returns>;

        // 手动迭代生成器以捕获返回值
        while (!(result = this._generator.next()).done) {
            const value = result.value;
            this._generated.push(value);
        }

        // 此时 result.done 为 true，result.value 是返回值
        this._done = true;
        // 无条件存储返回值（包括 undefined）
        this._returns = result.value as Returns;

        return {
            generated: this._generated,
            returns: this._returns,
        };
    }

    /**
     * 收集所有 yielded 的值和返回值
     * @returns 包含 generated 和 returns 的结果
     */
    collect(): Element[] {
        const { generated } = this.generateAll();
        return generated;
    }

    /**
     * 消耗生成器，返回其返回值
     * @returns 生成器的返回值
     */
    consume(): Returns {
        const { returns } = this.generateAll();
        return returns;
    }
}

// ============ 异步迭代器支持 ============

/**
 * 从 AsyncGenerator 中提取返回值
 *
 * TypeScript 的 async generator 可以直接返回值，无需包装类
 *
 * @example
 * ```typescript
 * async function* gen(): AsyncGenerator<number, string> {
 *   yield 1;
 *   yield 2;
 *   return 'done';
 * }
 *
 * const extractor = new ExtractorAsync(gen());
 * const result = await extractor.collect();
 * // result.generated = [1, 2]
 * // result.returns = 'done'
 * ```
 *
 * @typeParam Element - yield 的值的类型
 * @typeParam Returns - return 的值的类型
 */
export class ExtractAsync<Element, Returns> implements AsyncIterable<Element> {
    /** 原始异步生成器 */
    private readonly _generator: AsyncGenerator<Element, Returns, unknown>;

    /** 已生成的值 */
    private readonly _generated: Element[] = [];

    /** 存储的返回值 */
    private _returns: Returns | typeof NONE = NONE;

    /**
     * 获取返回值
     * @returns 返回值，如果不存在则返回 undefined
     */
    get returns(): Returns | undefined {
        if (this._returns !== NONE) {
            return this._returns as Returns;
        }
        return undefined;
    }

    /** 已生成的值数量 */
    get length(): number {
        return this._generated.length;
    }

    /**
     * @param generator - 要从中提取返回值的异步生成器
     */
    constructor(generator: AsyncGenerator<Element, Returns, unknown>) {
        this._generator = generator;
    }

    /**
     * 实现 AsyncIterable 接口，支持 for...await...of 遍历
     */
    [Symbol.asyncIterator](): AsyncIterator<Element, Returns, unknown> {
        return {
            next: async (): Promise<IteratorResult<Element, Returns>> => {
                const result = await this._generator.next();
                if (result.done) {
                    // 捕获返回值
                    if (this._returns === NONE && result.value !== undefined) {
                        this._returns = result.value;
                    }
                    return { done: true, value: result.value as Returns };
                }
                this._generated.push(result.value);
                return { done: false, value: result.value };
            },
        };
    }

    /**
     * 生成所有值并返回
     * @returns Promise<所有生成的值>
     */
    async collect(): Promise<Element[]> {
        const { generated } = await this.generateAll();
        return generated;
    }

    /**
     * 收集所有 yielded 的值和返回值
     * @returns Promise<包含 generated 和 returns 的结果>
     */
    async generateAll(): Promise<ExtractResult<Element, Returns>> {
        let result: IteratorResult<Element, Returns>;

        // 手动迭代生成器以捕获返回值
        while (!(result = await this._generator.next()).done) {
            const value = result.value;
            this._generated.push(value);
        }

        // 此时 result.done 为 true，result.value 是返回值
        if (result.value !== undefined) {
            this._returns = result.value;
        }

        return {
            generated: this._generated,
            returns: this.returns as Returns,
        };
    }

    /**
     * 消耗生成器，返回其返回值
     * @returns Promise<生成器的返回值>
     */
    async consume(): Promise<Returns> {
        const { returns } = await this.generateAll();
        return returns;
    }
}

// ============ 工厂函数 ============

/**
 * 便捷工厂函数（同步异步兼容）
 *
 * @example
 * const result = extract(generator).collect();
 *
 * @example
 * const result = extract(asyncGenerator).collect();
 */
export function extract<Element, Returns>(
    generator: Generator<Element, Returns, unknown>,
): Extract<Element, Returns>;
export function extract<Element, Returns>(
    generator: AsyncGenerator<Element, Returns, unknown>,
): ExtractAsync<Element, Returns>;
export function extract<Element, Returns>(
    generator:
        | Generator<Element, Returns, unknown>
        | AsyncGenerator<Element, Returns, unknown>,
): Extract<Element, Returns> | ExtractAsync<Element, Returns> {
    return isAsyncGenerator(generator)
        ? new ExtractAsync(generator)
        : new Extract(generator);
}

export function isAsyncGenerator(
    obj: Generator | AsyncGenerator,
): obj is AsyncGenerator<any, any, any> {
    return (obj as any)[Symbol.toStringTag] === "AsyncGenerator";
}

/**
 * 便捷工厂函数（异步版）
 *
 * @example
 * const result = await extractAsync(asyncGenerator).collect();
 */
export function extractAsync<Element, Returns>(
    generator: AsyncGenerator<Element, Returns, unknown>,
): ExtractAsync<Element, Returns> {
    return new ExtractAsync(generator);
}
