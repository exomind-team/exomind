## 代码评审报告 — issue-198 (f8cf4dfc..HEAD)

> 评审范围：33 个文件，+1863 / -87 行
> 评审角色：UI/UX · 架构 · 测试（并行）

---

### 总体评分

| 维度 | 评分 | 说明 |
|------|------|------|
| UI/UX 实现 | 8/10 | 组件拆分清晰，风格一致，有两处小问题 |
| 架构设计 | 8.5/10 | IA 合理，路由设计干净，desktop-adaptive 模块设计好 |
| 测试质量 | 7/10 | 覆盖主路径，但缺少交互测试和边界条件 |

---

### ✅ 优点

**UI/UX**
- `AboutSection` 成功将官网/赞助/法律与支持合并为一个卡片，减少了 Settings 页面的视觉噪音
- `LegalSection` / `MoreSection` 组件职责单一，图标选择语义准确（Shield=隐私、FileText=协议、Code=开源声明）
- `LegalSupportPage` 返回按钮使用 `navigate({ to: '/settings' })` 而非 `navigate(-1)`，避免了历史栈问题
- 危险区域在移动端和桌面端都正确置于底部（`sectionDangerRef` 在 tab 列表末位）
- `desktop-adaptive.ts` 双事件机制（`storage` + `CustomEvent`）支持跨 tab 同步，设计周到

**架构**
- `legal-support` 作为独立路由 `/settings/legal-support` 而非 modal，符合深链接和返回导航的最佳实践
- `DesktopTabKey` 类型约束了 tab 导航的合法值，类型安全
- `normalizeBoolean` 处理 `null` 默认为 `true`（默认开启桌面适配），语义正确

**测试**
- `LegalSection.test.tsx` 的隔离测试验证了"法律三项不包含官网/赞助/帮助"，是有效的边界测试
- `new-settings-about-merge` 测试验证了合并后的 About 卡片结构
- E2E 配置 `playwright.issue198.config.ts` 独立于主配置，不影响 CI 主流程

---

### ⚠️ 问题

#### Important

**1. `AboutSection.tsx:43,49` — 版本和构建使用相同的 `Package` 图标**
```tsx
// 版本
icon={<Package className="h-[18px] w-[18px] text-[#78716C]" />}
// 构建
icon={<Package className="h-[18px] w-[18px] text-[#78716C]" />}
```
两行视觉完全相同，用户无法区分。建议版本用 `Tag`，构建用 `GitCommit` 或 `Hash`。

**2. `LegalSupportPage.tsx:25` — `onComingSoon` 传入空函数**
```tsx
<LegalSection onComingSoon={() => {}} />
```
点击隐私政策/用户协议/开源声明没有任何反馈，用户会以为按钮坏了。至少应该 toast 提示"即将上线"，与其他 `onComingSoon` 行为保持一致。

**3. `MoreSection.tsx:45` — "遥测"使用 `Shield` 图标语义不准**
`Shield` 在 `AboutSection` 已用于"法律与支持"，在 `MoreSection` 又用于"遥测"，造成图标语义冲突。建议遥测改用 `Activity` 或 `BarChart2`。

#### Minor

**4. `NewSettingsPage.tsx:513` — 危险区 tab 顺序**
```ts
{ key: 'about', label: '关于', ref: sectionAboutRef },
{ key: 'danger', label: '危险区域', ref: sectionDangerRef },
```
危险区在 tab 列表末位是正确的，但 `DesktopTabKey` 类型定义中 `danger` 排在 `about` 前面（`'theme' | 'focus' | 'notification' | 'danger' | 'about'`），与实际渲染顺序不一致，容易误导后续维护者。

**5. 测试缺少点击交互验证**
`MoreSection.test.tsx` 和 `LegalSection.test.tsx` 只测试渲染，没有测试点击回调是否被调用。建议补充：
```tsx
it('calls onComingSoon when clicking 帮助中心', async () => {
  const onComingSoon = vi.fn();
  render(<MoreSection onNavigateUpdate={() => {}} onComingSoon={onComingSoon} />);
  await userEvent.click(screen.getByText('帮助中心'));
  expect(onComingSoon).toHaveBeenCalledOnce();
});
```

**6. `docs/pr/` 目录积累了大量临时文件**
`issue-198-*.md` 共 10+ 个文件，建议合并后清理，避免 repo 噪音。

---

### 📋 建议优先级

| 优先级 | 问题 | 操作 |
|--------|------|------|
| 🔴 Important | `LegalSupportPage` 空 `onComingSoon` | 传入 `showComingSoon` 或 toast |
| 🟡 Important | `AboutSection` 重复 `Package` 图标 | 改用 `Tag` + `GitCommit` |
| 🟡 Important | `MoreSection` 遥测图标语义冲突 | 改用 `Activity` |
| 🟢 Minor | `DesktopTabKey` 类型顺序 | 与渲染顺序对齐 |
| 🟢 Minor | 补充点击回调测试 | `vi.fn()` + `userEvent.click` |
| 🟢 Minor | 清理 `docs/pr/` 临时文件 | 合并后删除 |

---

### 结论

整体实现质量良好，IA 重构方向正确，`desktop-adaptive` 模块设计扎实。
主要需要修复的是 `LegalSupportPage` 的空 `onComingSoon`（用户体验问题）和图标语义冲突（视觉一致性问题）。
其余为 minor，可在本 PR 内修复或后续跟进。
