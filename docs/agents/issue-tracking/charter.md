# ExoMind Issue 追踪执行章程（Agent）

> 目标：把用户的追踪请求稳定转为“查重 → 现状核查 → 新建/追加 → 关联依赖 → 回报”的标准化动作，避免重复、遗漏与语义漂移。

## 1. 适用范围

- Bug / 回归 / 体验缺陷
- 功能请求
- 架构/产品讨论
- 设计原则澄清

## 2. 强制原则（不可跳过）

1. **无则创建，有则追加评论**：先查重再行动。
2. **必须核查当前 dev 实现**：追踪前先看 `dev` 分支代码现状。
3. **必须包含“预期/实际”**：对立呈现需求张力。
4. **必须包含“现状快照”**：写明 `dev` 短 hash + 关键文件路径。
5. **强制双向关联**：新旧 issue 互链（正文 + 评论）。
6. **严格去重**：几乎同问题才追加，其他新建并互链。
7. **多问题强制拆分**：一个 issue 只追踪一个原子问题。

## 3. 执行 SOP

1. **抽取问题原子点**（拆分多问题）
2. **查重检索**（open + closed）
3. **核查 dev 现状**（代码/实现/行为）
4. **决策新建/追加/回归**
5. **创建/追加 + 标签**
6. **添加依赖关系（GraphQL）**
7. **回报用户：决策说明 + 当前状态 + 下一步建议**

## 4. Issue 正文模板（核心字段版）

```md
## 背景
- 用户反馈：
- 影响范围：

## 预期

## 实际

## 现状快照
- dev: <short-hash>
- 关键路径：<file path>

## 验收标准
- [ ] AC1
- [ ] AC2

## 关联/依赖
- 关联：#123 #456
- 阻塞：#789
- 子问题：#234
```

**注意**：
- “实际”只描述效果，不写推测原因。
- “现状快照”必须可定位到具体提交与文件。

## 5. 标签规则（对齐仓库已有标签）

- 平台：`UI` / `Web` / `Tauri` / `移动端`
- 领域：`时间块` / `事件日志` / `Agent` / `sync` / `架构` / `research`
- 优先级：
  - 默认 `P2`
  - 影响面大或阻塞链路：`P1`
  - 数据丢失/系统不可用：`P0`

## 6. 依赖关系（GraphQL 强制）

### 6.1 关系类型（优先级）

- **阻塞为主**：实现先后依赖 → `blocked by`
- **父子谨慎**：仅在领域高度相关且范围覆盖时使用
- 若适用：**父子 + 阻塞都建**

### 6.2 GraphQL 最小命令集

**获取 issue node id：**

```bash
gh api graphql -f query='
  query {
    repository(owner:"exomind-team",name:"exomind") {
      issue(number:123){ id }
    }
  }'
```

**添加阻塞：**

```bash
gh api graphql -f query='
  mutation($issueId:ID!,$blockingIssueId:ID!){
    addBlockedBy(input:{issueId:$issueId,blockingIssueId:$blockingIssueId}){ clientMutationId }
  }' -f issueId=<ISSUE_ID> -f blockingIssueId=<BLOCKING_ID>
```

**添加子问题：**

```bash
gh api graphql -f query='
  mutation($issueId:ID!,$subIssueId:ID!){
    addSubIssue(input:{issueId:$issueId,subIssueId:$subIssueId}){ clientMutationId }
  }' -f issueId=<ISSUE_ID> -f subIssueId=<SUB_ID>
```

### 6.3 失败兜底

GraphQL 失败时必须：
1. 在 issue 正文的“关联/依赖”区保留 Markdown 列表；
2. 追加评论记录失败原因与待补操作（命令级别）。

## 7. 引用与关联规范

- 正文可就近引用 `#编号`
- **必须**在“关联/依赖”区用 Markdown 列表聚合
- 新建 issue 时，旧 issue 要追加回链评论

## 8. 回报用户格式（必须）

- 决策说明（追加/新建/回归）
- 当前状态（issue 编号、状态）
- 下一步建议（可执行动作）

---

最后更新：2026-03-15
