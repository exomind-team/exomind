/**
 * 通用类型定义
 */

// ============ 常量 ============

/** 美元人民币汇率 */
export const USD_RMB_RATIO = 7;

/** None 标记符号 */
export const NONE = Symbol('NONE');

// ============ 类型定义 ============

// 可迭代迭代器接口
export interface IterableIterator<T, TReturn = any, TNext = any>
  extends Iterable<T>,
  Iterator<T, TReturn, TNext> { }

// 泛型构造函数类型
export type Constructor<T = object> = new (...args: any[]) => T;

// 泛型类实例创建函数
export type InstanceCreator<T> = new () => T;

// JSON 兼容类型
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

// 消息内容类型
export interface MessageContent {
  type: string;
  text?: string;
  [key: string]: any;
}

// 话题标签
export type Topic = string;

// ============ 工具函数 ==========

// 空函数
export const noop = () => { };

declare global {
  function setTimeout(handler: Function, timeout?: number, ...args: any[]): number;
}

// 延迟函数
export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
