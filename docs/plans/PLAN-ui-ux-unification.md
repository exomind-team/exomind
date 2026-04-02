# 前端 UI/UX 统一重构计划（Issue #807 总览入口）

> **Issue**: [#807](https://github.com/exomind-team/exomind/issues/807)
> **状态**: Reviewed and reframed（已评审并重构）
> **最后更新**: 2026-04-02

---

## 1. 这份文件现在负责什么

这不是最终实施细节文档，而是 **Issue #807 的总览入口**。

它负责回答三件事：

1. 为什么要做前端统一化
2. 旧计划里哪些方向有问题
3. 现在应该看哪两份正式文档

正式文档如下：

- **前端设计规范 / Frontend UI Spec（前端 UI 规范）**
  `docs/development/ui-spec.md`
- **Issue #807 实施计划 / Implementation Plan（实施计划）**
  `docs/plans/2026-04-02-issue-807-ui-unification-implementation-plan.md`

---

## 2. 现状诊断（保留结论）

当前前端 UI 存在系统性不一致问题，关键现象包括：

- 硬编码颜色大量存在
- 原生 `<select>` 仍在多个页面使用
- tab 语义和模式切换语义混用
- 页面壳层没有统一边界
- 设置页局部已形成统一系统，但尚未升格为全项目标准

一句话版：

> 现在不是“没有规范”，而是“规范只在局部生效，还没有变成全项目默认规则”。

---

## 3. 旧计划评审结论

### P0 问题（方向性错误）

1. **“所有 tab-like UI 都收敛到 Tabs”是错误目标。**
   某些 UI 是模式切换或锚点导航，不是真 tab。

2. **“所有页面都必须使用 PageShell”是错误目标。**
   graph、topology、overlay、全屏浮层不属于普通内容页。

3. **“硬编码颜色归零”不应该作为单 issue 的绝对验收条件。**
   需要文档化例外，而不是误伤特殊表面。

### P1 问题（计划可执行性不足）

1. 没有先落正式 spec
2. 没有接入 `CLAUDE.md / AGENTS.md`
3. 缺少页面分类法
4. 缺少 Windows PowerShell 友好的验证命令
5. 缺少特殊页面例外策略

---

## 4. 修订后的核心策略

Issue #807 的正确推进方式不是“一口气统一全部页面”，而是三步：

1. **先固化规范**
   把 Settings 的成功经验整理成项目级 spec
2. **再收口共享层**
   明确 `PageShell / PageTabs / Select / Dialog / Drawer` 的边界
3. **最后分层迁移页面**
   普通页面优先，复杂页面慎改，特殊页面只治理基础设施

---

## 5. 本次最终交付物

本轮文档工作完成后，Issue #807 的文档基础应包括：

- `docs/development/ui-spec.md`
- `docs/plans/2026-04-02-issue-807-ui-unification-implementation-plan.md`
- `CLAUDE.md` 中的规范入口
- `AGENTS.md` 中的规范入口
- `docs/README.md` 中的导航入口

---

## 6. 下一步怎么看

如果你是：

### 人类评审者

先看：

1. `docs/development/ui-spec.md`
2. `docs/plans/2026-04-02-issue-807-ui-unification-implementation-plan.md`

### Agent / 实施者

先看：

1. `CLAUDE.md` 或 `AGENTS.md`
2. `docs/development/ui-spec.md`
3. `docs/plans/2026-04-02-issue-807-ui-unification-implementation-plan.md`

---

## 7. 一句话总结

Issue #807 的目标已经从“粗暴统一页面样子”修正为：

> 建立一个人和 Agent 都能持续执行的前端设计规范，再按页面类型有边界地推进统一化。
