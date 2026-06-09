# WeFlow

本文件是 `WeFlow` 的本地化搜索指南，不是产品百科。

它的目标是帮助 Agent 在遇到相关目的时，快速判断：

- 这个参考源值不值得纳入交叉分析
- 应该先从哪些入口开始检索
- 哪些主题适合参考它
- 哪些主题不应把它当作主参考

## 适合优先参考的目的

当用户目的涉及以下方向时，优先考虑 `WeFlow`：

- 本地优先的微信聊天记录查看、导出、归档与分析产品
- 聊天数据如何在桌面端被组织成年度报告、双人报告、群聊画像等分析面
- 微信聊天记录怎样映射为本地 HTTP API 供自动化脚本、AI 工具或二次开发调用
- 隐私敏感数据“纯本地处理、不依赖云端”的产品叙事与能力包装
- Electron + React 桌面应用中“前端壳层 + 本地服务 + 数据解析 service” 的分层方式
- 聊天记录、多媒体、朋友圈、联系人等导出能力如何组合成一个统一桌面工具

## 不要把它当成主参考的情况

以下场景里，`WeFlow` 通常不应作为唯一主参考：

- 通用工作流编排、DAG 画布、agent orchestration 或 automation builder
- 云端优先、多租户、强实时协作的聊天 SaaS 或企业消息系统
- 非微信生态的通用 IM 数据平台
- 浏览器优先或移动优先的产品架构
- 合规公开 API 平台设计，而不是本地桌面侧的数据接入与解析

说明：

- 这里写的是“参考价值边界”，不是产品优劣判断。
- 尽管名字叫 `WeFlow`，它更适合作为“本地聊天数据产品与桌面集成参考”，而不是“workflow 产品参考”。

## 优先检索入口

### 1. 官方产品入口

- 官网：`https://weflow.top/`

适合先回答：

- 产品主张是不是“完全本地”“隐私优先”
- 当前主打的能力面有哪些
- 支持的平台、安装方式和使用边界是什么

优先关注：

- 完全本地 / 不依赖云端
- 聊天记录导出与备份
- 年度报告 / 双人报告 / 群聊分析
- HTTP API 映射
- 支持平台与微信版本边界

### 2. 官方技术研究入口

- 技术研究：`https://doc.weflow.top/`

适合先回答：

- 官方是否单独维护了“微信相关技术研究”入口
- 若要继续深挖微信数据解析或本地接入，应该沿哪条技术路线走
- 产品页没有展开的实现背景，是否有额外技术材料可追

如果目的是 `微信数据解析`、`本地消息映射`、`接口接入`、`导出链路`，优先检索这些关键词：

- 微信
- 聊天记录
- 解析
- HTTP API
- 导出

### 3. 官方开发文档

- HTTP API 文档：`https://github.com/hicccc77/WeFlow/blob/main/docs/HTTP-API.md`

适合先回答：

- 本地 API 如何启用、鉴权和访问
- 支持哪些消息、会话、联系人、朋友圈相关接口
- 是否支持主动推送、媒体访问和 ChatLab 兼容格式

优先关注：

- 启用方式
- 鉴权规范
- 健康检查
- 获取消息 / 会话 / 联系人
- 主动推送
- 朋友圈接口
- ChatLab 响应格式

### 4. GitHub 仓库与源码入口

优先看这些入口：

- 仓库：`https://github.com/hicccc77/WeFlow`
- README：`https://github.com/hicccc77/WeFlow/blob/main/README.md`
- 前端壳层：`https://github.com/hicccc77/WeFlow/tree/main/src`
- Electron 主进程：`https://github.com/hicccc77/WeFlow/tree/main/electron`
- 本地服务集合：`https://github.com/hicccc77/WeFlow/tree/main/electron/services`

如果目的是：

- 看产品能力、安装边界、导出格式：先看 `README`
- 看本地 HTTP API 的真实接线：先看 `docs/HTTP-API.md`、`electron/main.ts`、`electron/services/httpService.ts`
- 看聊天导出、年度报告、双人报告等分析能力如何拆分：先看 `electron/services/exportService.ts`、`electron/services/annualReportService.ts`、`electron/services/dualReportService.ts`
- 看聊天数据、朋友圈、语音转写等底层能力如何分层：先看 `electron/services/chatService.ts`、`electron/services/snsService.ts`、`electron/services/voiceTranscribeService.ts`
- 看桌面前端壳层如何挂接本地能力：先看 `src/App.tsx`、`src/pages`、`electron/preload.ts`

### 5. 发布与社区入口

- Releases：`https://github.com/hicccc77/WeFlow/releases`
- Issues：`https://github.com/hicccc77/WeFlow/issues`
- Telegram 频道：`https://t.me/weflow_cc`

适合先回答：

- 当前可下载版本和支持平台是否稳定
- 哪些能力还在早期阶段、接口是否有变动风险
- 用户反馈主要集中在哪些模块

优先关注这些主题：

- 微信版本兼容性
- 导出 / 媒体 / 朋友圈相关问题
- API 变动与二次开发反馈
- 安装与平台差异

## 面向常见目的的检索路线

### 目的：本地优先聊天记录产品怎么组织导出、分析与报告

建议路线：

1. 官网看产品定位和能力包装
2. README 看支持平台、导出格式和功能清单
3. 再到 `electron/services` 看导出、分析、年报能力的服务拆分

重点想确认的问题：

- 它如何把“查看、导出、分析、报告”包装成一个统一产品
- 哪些能力是核心能力，哪些是扩展能力
- 隐私、本地处理、多平台支持这些叙事是否一致

### 目的：聊天数据怎样映射为本地 HTTP API 供 AI 或自动化接入

建议路线：

1. 先看 `docs/HTTP-API.md`
2. 再看 README 里的 HTTP API 说明和默认端口、格式边界
3. 最后看 `electron/main.ts` 与 `electron/services/httpService.ts` 的实现入口

重点想确认的问题：

- API 如何启停、鉴权和返回数据
- 是否支持推送、拉取、媒体访问和标准化格式输出
- 这个能力是成熟稳定接口，还是仍在持续变动的早期接口

### 目的：桌面端微信数据解析、导出与分析能力如何分层

建议路线：

1. 先看 `package.json` 与仓库目录，确认 React + Electron 的整体结构
2. 再看 `electron/services` 中的 `chatService`、`exportService`、`analyticsService`、`snsService`
3. 必要时补 `doc.weflow.top` 的技术研究入口，看有没有更细的解析线索

重点想确认的问题：

- UI 壳层与本地能力之间如何解耦
- 数据解析、导出、报告、媒体处理是否按 service 拆分
- 哪些能力强依赖桌面平台与本地环境，而不是纯前端即可复用

## 适合从 WeFlow 借鉴什么

通常适合借鉴：

- 隐私敏感数据“纯本地处理”的产品表达方式
- 把查看、导出、分析、报告和本地 API 统一成一个桌面工具的能力包装
- Electron 主进程下以 service 为中心组织聊天解析、导出、报告与接口能力
- 用本地 HTTP API + 推送机制把桌面数据能力开放给外部工具
- 官网、GitHub、技术研究站三层入口各司其职的对外信息架构

## 不要急着从 WeFlow 借鉴什么

通常不要直接从它推导：

- 通用 workflow / DAG / agent 编排产品形态
- 云端同步、多人协作、租户隔离等服务端架构
- 可公开分发、长期稳定的开放平台 API 策略
- 非微信生态下的通用聊天数据模型
- 浏览器端即可独立运行的实现路径

## 一句话判断

如果用户目的是：

- “本地优先聊天记录导出 / 分析产品怎么做”
- “聊天数据怎样映射为本地 API 给 AI 或自动化用”
- “Electron 桌面工具里聊天解析、导出、年报这些能力怎样分层”

那么 `WeFlow` 应该进入优先参考源集合。
