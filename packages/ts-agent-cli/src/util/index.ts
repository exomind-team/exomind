// src/util/index.ts - util 模块聚合导出

// Extract 模块
export {
    Extract,
    extract,
    extractAsync,
    ExtractAsync as ExtractorAsync,
    type ExtractResult,
} from "./extract.js";

// JSON 数据类模块
export { JsonData, JsonDataWithPath } from "./json.js";

// 工具函数模块
export {
    findFirst,
    unixTimeNow,
    isWindows,
    isLinux,
    awaitSoft,
    tryOr,
    traceFile,
    traceFn,
} from "./functions.js";

// 路径工具模块
export {
    findGitRoot,
    getSameParentFile,
    getAgentMdPath,
    getStateJsonPath,
} from "./path.js";

// 类型定义模块
export type {
    IterableIterator,
    Constructor,
    InstanceCreator,
    JSONValue,
    MessageContent,
    Topic,
} from "./types.js";
export { USD_RMB_RATIO, NONE, noop, sleep } from "./types.js";
