# PouchDB + Vite 排错报告（2026-02-10）

## 1. 背景与目标
- 项目：`D:\project\exomind`
- 问题域：前端在 Vite 开发环境下加载 PouchDB 失败
- 目标：定位根因，稳定消除浏览器运行时报错，并补充可回归验证

## 2. 错误演进（按时间顺序）
1. 初始错误：
   - `Uncaught TypeError: Class extends value [object Object] is not a constructor or null`
   - 栈指向：`pouchdb/lib/index-browser.js`
2. 调整后错误：
   - `Uncaught SyntaxError: The requested module '/node_modules/spark-md5/spark-md5.js?...' does not provide an export named 'default'`
   - 栈指向：`index-browser.es.js`

说明：第二个错误是在修复第一层后暴露出来的下游兼容问题，不是独立新问题。

## 3. 排查方法
采用“先证据后修复”的流程：
- 检查实际导入链、`vite.config.ts` 与 PouchDB 依赖图
- 先写失败测试锁定配置行为，再修改配置转绿（TDD）
- 使用构建与模块请求双重验证

## 4. 关键证据

### 4.1 配置层证据（初始状态）
在 `vite.config.ts` 中存在：
- 将 `pouchdb` alias 到 `node_modules/pouchdb/lib/index-browser.js`
- 将 `pouchdb-utils` alias 到 `node_modules/pouchdb-utils/lib/index-browser.js`

这类“直指构建产物文件”的 alias 容易破坏 Vite 的依赖预构建与 CJS/ESM 互操作路径。

### 4.2 依赖源码证据（spark-md5）
- `pouchdb/lib/index-browser.es.js` 中是 `import Md5 from 'spark-md5'`
- `spark-md5` 包本身是 UMD/CJS（`module.exports = ...`），无原生 ESM `default` 导出

当 `pouchdb` 被排除预构建后，若 `spark-md5` 未被单独预构建成 ESM 互操作包装，就会报“does not provide default export”。

### 4.3 依赖源码证据（events）
- `pouchdb/lib/index-browser.es.js` 与 `pouchdb-utils/lib/index-browser.es.js` 里都 `import ... from 'events'`
- 两者包含多处 `class Xxx extends EE/EventEmitter`

Vite 默认会把 Node 内建 `events` externalize 为浏览器 proxy。若继续走 proxy，`extends` 目标可能不是可构造函数，容易复现第一类 `Class extends value [object Object]` 报错。

### 4.4 实际运行请求证据（修复后）
验证请求结果显示：
- `pouchdb/index-browser.es.js` 中 `spark-md5` 已指向 `/node_modules/.vite/deps/spark-md5.js`
- `events` 已指向 `/node_modules/.vite/deps/events.js`
- 不再出现 `__vite-browser-external:events`

这说明两层互操作都已落到可执行的浏览器依赖包装。

## 5. 根因结论
本次问题不是单点故障，而是三层叠加：
1. 手工 alias 到 PouchDB 原始浏览器构建文件，破坏了稳定的依赖处理路径。
2. `spark-md5`（UMD/CJS）在该路径下未正确获得 ESM default 互操作包装。
3. `events` 被 Vite 外部化为 browser-external proxy，导致 `class extends` 运行时风险。

## 6. 修复方案（已实施）

### 6.1 `vite.config.ts`
- 删除：`pouchdb`/`pouchdb-utils` 指向 `index-browser.js` 的 alias
- 新增：
  - `optimizeDeps.include = ['spark-md5', 'vuvuzela']`
  - `optimizeDeps.exclude = ['pouchdb', 'pouchdb-find', 'pouchdb-browser']`
  - `resolve.alias.events = 'events'`

### 6.2 依赖
- 在 `package.json` 增加：`"events": "^3.3.0"`

### 6.3 回归测试
新增文件：
- `tests/unit/config/vite-pouchdb-interop.test.ts`

覆盖点：
- 不允许将 `pouchdb` alias 到原始 browser bundle
- 不允许将 `pouchdb-utils` alias 到原始 browser bundle
- 要求 `optimizeDeps.exclude` 含 `pouchdb`
- 要求 `optimizeDeps.include` 含 `spark-md5` 与 `vuvuzela`
- 要求存在 `events` 的 browser polyfill alias

## 7. 验证结果

已执行并通过：
1. `npm run test -- tests/unit/config/vite-pouchdb-interop.test.ts tests/unit/config/vite-spark-md5-interop.test.ts tests/sync/spark-md5.test.ts`
   - 结果：3 个测试文件通过，10 个测试通过
2. `npm run build`
   - 结果：构建成功
3. `npx vite optimize --force`
   - 结果：预构建列表包含 `spark-md5`、`vuvuzela`
4. 请求 dev server 模块验证
   - 结果：`events` 已从 `.vite/deps/events.js` 提供，不再是 browser-external proxy

## 8. 排查过程中的限制与说明
- 试图使用 Playwright 做页面级复现时，遇到浏览器二进制下载网络中断（`ECONNRESET`），因此改为“构建 + 模块请求 + 配置测试”的组合验证。
- 本地 `1420/1421` 端口已有开发进程占用，验证过程中采用了不干扰主进程的方式。

## 9. 建议的运行步骤
1. 重启开发服务器（建议带 `--force` 触发依赖重算）
2. 浏览器强刷（`Ctrl+Shift+R`）
3. 若仍有报错，优先贴这两项：
   - 浏览器控制台完整堆栈
   - `http://127.0.0.1:1420/node_modules/pouchdb/lib/index-browser.es.js` 前 5 行

## 10. 影响文件清单
- `vite.config.ts`
- `package.json`
- `tests/unit/config/vite-pouchdb-interop.test.ts`
