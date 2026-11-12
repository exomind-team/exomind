---
name: exomind-next-access
description: 读取或记录新版外心上下文缓冲区、查看或控制时间块、获取有来源的回顾。仅适用于 exomind-buffer/1，不适用于旧 RT。先核对连接和权限，写入保留稳定操作 ID，读取失败不得返回空成功。
metadata:
  version: "0.6.0-rebuild.1"
  protocol: "exomind-buffer/1"
---

# 新外心接入

你是外部调用者，不是外心自身，也不是全空间管理员。用户的记忆、生活与休息记录不是可随意评分、删改或外发的任务列表。

## 先建立明确范围

读取用户提供的私有连接描述符，使用 `url/token/ca`。先访问 `/v1/hello`，确认 `protocol === 'exomind-buffer/1'`，再核对 deviceId/spaceId。不同协议停止，不能猜旧端口、profile/user_id/anonymous、沿用旧 skill 或把健康响应当数据授权。

优先使用独立 observer/writer。不要扫描机器寻找密钥；不要把连接文件、邀请、token或用户正文写入公共报告。当前令牌是空间级，不是逐记录权限，读取范围仍按用户任务缩小。

HTTP全部通过验证的地址，带 Bearer，JSON写入显式content-type。不跟随重定向，不关闭TLS验证。非本机HTTP只在用户明确设置的受信私网实验中使用。

## 常见操作

本目录所属候选提供 `tools/client.mjs`，从 `next/` 目录调用：

```sh
node tools/client.mjs status --connection /private/exomind-observer.json
node tools/client.mjs events --connection /private/exomind-observer.json
node tools/client.mjs capture --connection /private/exomind-writer.json --id <预先生成并保存的小写UUID> --text "用户明确要记录的内容"
node tools/client.mjs start --connection /private/exomind-writer.json --id <稳定UUID> --name "阅读" --text "开始备注"
node tools/client.mjs end --connection /private/exomind-writer.json --id <新的稳定UUID> --block-id <开始操作ID> --text "结束反馈"
```

`events`会取一个有限快照的全部分页，可能含大量私人内容；只有任务确需时才执行，默认不要把其stdout复制给无关系统。窄查询用HTTP：

- `/v1/timeline?before=N` 或 `/v1/search?q=...&before=N`：nextBefore直到null才是该范围读取完成。
- `/v1/operations/{id}`：查看原文、来源和附件元数据。
- `/v1/views/current`：当前时间块、采样时间与本地快照；active空不代表最近没活动。
- `/v1/blocks/{id}`：完整开始、结束和反馈；end_conflict要如实报告。
- `/v1/jobs`：本地总结状态；waiting_provider不是成功，失败不是空总结。

完整合同位于 `../../docs/API.md`。这些相对路径只在本候选源码布局中有效；安装技能到其他位置时，应同时保留合同引用或明确源码根，不猜实际路径。

## 写入必须可重试而不重复

先生成并持久记录操作ID、正文、附件与目标blockId，之后才发送。回执id必须等于请求id，durability必须为local_committed。它只确认本机，不确认其他设备。

网络超时或回执丢失：保持相同ID和相同内容重试，也可按ID回读。不要生成新ID绕过不确定结果。409内容冲突应核对，不能悄悄覆盖或把失败改成“记好了”。使用同一令牌身份重试；更换来源可能改变规范化命令。

文件先哈希、begin、按已确认offset上传、commit，验证后再capture。文件不存在/未补齐时明确说明，不能声称已阅读图片或文档。文件与播放列表的引用媒体是不同对象。

## 回顾与交接

引用原事件ID和原文，区分用户陈述、模型推断、缺失和读取失败。记录少不等于现实活动少；工作、休息、生活都可以成为时间块，不强求成果或建议。

读取部分分页或遇错，必须说明覆盖边界，不能继续输出“完整复盘”。summary的evidence只是引用集合校验通过，不是机器证明结论为真。对可疑结论回读原事件，不递归把旧总结当更可靠事实。

用户要求结束时间块时，需要实际命令回执；仅渲染一个停止按钮不表示执行。写入授权不等于允许你自动申请管理令牌、启动外部工具、创建任务或删除内容。

## 不在本版能力内

旧RT迁移、任务管理、主动清理及删除传播、通用shell/工具执行、任意网页抓取、媒体语义解析均未实现。不要发明端点；使用外部工具前另核对授权，并保留来源与失败边界。

总结取消/重试、配对/撤销及令牌管理需要owner，普通writer没有权限。诊断可用于交接，但分享前脱敏设备名、地址与标识。不要对日用库运行测试，也不要为了修同步自动删库。
