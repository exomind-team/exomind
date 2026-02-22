/**
 * JsonData - JSON 序列化数据类
 *
 * 递归 JSON 序列化/反序列化支持
 */

import fs from "fs";

// ============ JSON 数据类 ============

/**
 * 可以序列化为 JSON 的数据类
 *
 * 约束：所有字段都要有默认值
 */
export abstract class JsonData {
    /** 子类需要实现此方法判断键是否需要忽略 */
    protected static _keyNeedIgnore(_key: string): boolean {
        return false;
    }

    /**
     * 判断某个键是否需要忽略
     * @param key - 键名
     * @returns 是否忽略
     */
    static keyNeedIgnore<T extends typeof JsonData>(
        _this: T,
        key: string,
    ): boolean {
        return (this.prototype as unknown as T)._keyNeedIgnore(key);
    }

    /**
     * 递归转换为 JSON 对象
     * @returns 可 JSON 序列化的对象
     */
    intoJson(): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(this)) {
            if ((this.constructor as typeof JsonData)._keyNeedIgnore(key)) {
                continue;
            }
            if (value instanceof JsonData) {
                result[key] = value.intoJson();
            } else {
                result[key] = value;
            }
        }
        return result;
    }

    /**
     * 从 JSON 数据创建对象
     * @param Cls - 类构造函数，对应Python的`@classmethod`的cls
     * @param data - JSON 数据
     * @returns 新实例
     */
    static fromJson<T extends JsonData>(
        Cls: new () => T,
        data: Record<string, unknown>,
    ): T {
        const instance = new Cls();
        for (const key of Object.keys(instance)) {
            if ((Cls as unknown as typeof JsonData)._keyNeedIgnore(key)) {
                continue;
            }
            if (key in data) {
                const value = data[key];
                const currentValue = (instance as Record<string, unknown>)[key];
                if (
                    currentValue instanceof JsonData &&
                    typeof value === "object" &&
                    value !== null
                ) {
                    (instance as Record<string, unknown>)[key] =
                        JsonData.fromJson(
                            currentValue.constructor as new () => JsonData,
                            value as Record<string, unknown>,
                        );
                } else {
                    (instance as Record<string, unknown>)[key] = value;
                }
            }
        }
        return instance;
    }

    /**
     * 尝试从 JSON 数据创建对象
     * @param Cls - 类构造函数，对应Python的`@classmethod`的cls
     * @param data - JSON 数据
     * @returns 新实例或 null
     */
    static tryFromJson<T extends JsonData>(
        Cls: new () => T,
        data: Record<string, unknown>,
    ): T | null {
        try {
            return JsonData.fromJson(Cls, data);
        } catch {
            return null;
        }
    }

    /**
     * 序列化为 JSON 字符串
     * @returns JSON 字符串
     */
    json(): string {
        return JSON.stringify(this.intoJson(), undefined, 4);
    }

    /**
     * 解析 JSON 字符串
     * @param Cls - 类构造函数，对应Python的`@classmethod`的cls
     * @param data - JSON 字符串
     * @returns 新实例
     */
    static parse<T extends JsonData>(Cls: new () => T, data: string): T {
        return JsonData.fromJson(Cls, JSON.parse(data));
    }

    /**
     * 尝试解析 JSON 字符串
     * @param Cls - 类构造函数，对应Python的`@classmethod`的cls
     * @param data - JSON 字符串
     * @returns 新实例或 null
     */
    static tryParse<T extends JsonData>(
        Cls: new () => T,
        data: string,
    ): T | null {
        try {
            return JsonData.parse(Cls, data);
        } catch {
            return null;
        }
    }
}

/**
 * JSON 数据，带有被忽略的「路径参数」
 *
 * 便于只靠自身调用 `save()`
 */
export abstract class JsonDataWithPath extends JsonData {
    /** 文件路径（将被忽略） */

    /**
     * 判断某个键是否需要忽略
     * @param key - 键名
     * @returns 是否忽略
     */
    protected static override _keyNeedIgnore(key: string): boolean {
        return key === "filePath";
    }

    constructor(public filePath: string | null = null) {
        super();
    }

    /**
     * 从文件加载
     * @param Cls - 类构造函数，对应Python的`@classmethod`的cls
     * @param path - 文件路径
     * @returns 新实例
     */
    static load<T extends JsonDataWithPath>(
        Cls: new (filePath?: string) => T,
        path: string,
    ): T {
        const content = fs.readFileSync(path, "utf-8");
        const instance = JsonData.parse(Cls, content);
        instance.filePath = path;
        return instance;
    }

    /**
     * 从文件加载或创建新实例
     * @param Cls - 类构造函数，对应Python的`@classmethod`的cls
     * @param path - 文件路径
     * @returns 实例
     */
    static loadOrNew<T extends JsonDataWithPath>(
        Cls: new (filePath?: string) => T,
        path: string,
    ): T {
        if (!path || !fs.existsSync(path)) {
            console.warn(`[warn] 未找到路径(${path})，创建一个默认的`);
            return new Cls(path);
        }
        return JsonDataWithPath.load(Cls, path);
    }

    /**
     * 尝试加载
     * @param Cls - 类构造函数，对应Python的`@classmethod`的cls
     * @param path - 文件路径
     * @returns 实例或 null
     */
    static tryLoad<T extends JsonDataWithPath>(
        Cls: new (filePath?: string) => T,
        path: string,
    ): T | null {
        try {
            return JsonDataWithPath.load(Cls, path);
        } catch {
            return null;
        }
    }

    /**
     * 尝试加载或创建新实例
     * @param Cls - 类构造函数，对应Python的`@classmethod`的cls
     * @param path - 文件路径
     * @returns 实例
     */
    static tryLoadOrNew<T extends JsonDataWithPath>(
        Cls: new (filePath?: string) => T,
        path: string,
    ): T {
        try {
            return JsonDataWithPath.loadOrNew(Cls, path);
        } catch (e) {
            console.warn(`[warn] 加载出错(${e})，创建一个默认的`);
            return new Cls(path);
        }
    }

    /**
     * 保存到文件
     * @param path - 路径，为空则使用自身存储的路径
     * @throws 如果未指定保存路径
     */
    save(path?: string | null): void {
        const filePath = path || this.filePath;
        if (!filePath) {
            throw new Error(`异常：未指定保存路径`);
        }
        const jsonData = this.json();
        fs.writeFileSync(filePath, jsonData, "utf-8");
    }
}
