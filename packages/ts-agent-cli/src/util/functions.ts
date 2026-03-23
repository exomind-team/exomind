/**
 * Functions - 通用工具函数
 *
 * 包含 findFirst, unixTimeNow, isWindows, isLinux, awaitSoft, tryOr, traceFile, traceFn
 */

// ============ 工具函数 ============

/**
 * 从可迭代对象中找到第一个满足条件的元素
 * @param predicate - 条件函数
 * @param iterable - 可迭代对象
 * @returns 找到的元素或 undefined
 */
export function findFirst<T>(
  predicate: (element: T) => boolean,
  iterable: Iterable<T>
): T | undefined {
  for (const element of iterable) {
    if (predicate(element)) {
      return element;
    }
  }
  return undefined;
}

/**
 * 获取当前 Unix 时间戳（毫秒）
 * @returns Unix 时间戳
 */
export function unixTimeNow(): number {
  return Date.now();
}

/**
 * 判断当前操作系统是否为 Windows
 * @returns 是否为 Windows
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * 判断当前操作系统是否为 Linux
 * @returns 是否为 Linux
 */
export function isLinux(): boolean {
  return process.platform === 'linux';
}

/**
 * 如果对象是 Promise，则等待其完成，否则直接返回
 * @param obj - 对象
 * @returns Promise 或原始对象
 */
export async function awaitSoft<T>(obj: T | Promise<T>): Promise<T> {
  if (obj instanceof Promise) {
    return await obj;
  }
  return obj;
}

/**
 * 尝试执行函数，若出错则返回默认值
 * @param func - 要执行的函数
 * @param catchType - 捕捉的异常类型
 * @param defaultValue - 默认值
 * @returns 函数返回值或默认值
 */
export function tryOr<T>(
  func: () => T,
  catchType: typeof Error = Error,
  defaultValue: T | null = null
): T | null {
  try {
    return func();
  } catch {
    return defaultValue;
  }
}

// ============ 调试追踪工具 ============

/**
 * 返回当前调用栈的第一个文件名及行号
 * 若无调用栈，则返回 <unreachable: no stack: ...>
 */
export function traceFile(): string {
  const err = new Error();
  const stack = err.stack;

  if (!stack) {
    return '<unreachable: no stack>';
  }

  // 解析堆栈跟踪
  const lines = stack.split('\n');
  // 跳过第一行（Error）和第二行（traceFile 本身），找到调用者
  // 格式: "at 函数名 (文件名:行号:列号)" 或 "at 文件名:行号"
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/at\s+(?:.*?\s+)?(.+?):(\d+):?\d*\)?$/);
    if (match) {
      return `${match[1]}:${match[2]}`;
    }
  }

  return '<unreachable: no stack>';
}

/**
 * 返回当前调用栈的函数名
 * 若无调用栈，则返回 <unreachable: no stack: ...>
 */
export function traceFn(): string {
  const err = new Error();
  if (!err.stack) {
    return '<unreachable: no stack>';
  }

  const lines = err.stack.split('\n');
  const fnNames: string[] = [];

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    // 解析 "at 函数名 (文件名:行号)" 格式
    const match = line.match(/at\s+(?:.*?\s+)?(.+?)\s*\(/);
    if (match && match[1]) {
      fnNames.push(match[1]);
    }
  }

  return fnNames.join('/') || '<unreachable: no stack>';
}
