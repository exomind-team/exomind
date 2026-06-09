# 威胁模型：GitHub 隐私泄露的持久化机制

---

## 各渠道持久化时间窗口

| 渠道 | 持续时长 | 可主动消除 | 备注 |
|------|----------|------------|------|
| GitHub issue/PR 正文 | 直到删除 | ✅ 可删除 | 先混淆再删除 |
| GitHub issue 编辑历史 | 随 issue 删除一并消失 | ✅（删 issue 即可） | 删除前编辑历史对任何人可见 |
| GitHub Events API | **30 天** | ❌ 无法主动清除 | issue 创建/push 事件包含原始标题/SHA |
| 悬空 Git 对象（force push 后） | **~90 天**（GC 前） | ❌ 需联系 GitHub Support | 旧 SHA 仍可通过直接 URL 访问 |
| GitHub 代码搜索索引 | 数天~数周 | ❌ 无法主动清除 | 删除/重写后逐渐失效 |
| Wayback Machine | 永久 | 需提交移除请求 | 小仓库被自动抓取概率低 |
| 外部搜索引擎缓存 | 数天~数月 | 可通过各引擎工具申请 | 需单独向 Google/Bing 申请 |
| 已接收的邮件通知 | 永久 | ❌ 无法撤回 | 关注者在 issue 创建时即收到推送 |

---

## 为什么「混淆后删除」优于「直接删除」

直接删除 issue 和先混淆再删除，对 **GitHub 内部存储**没有区别——两个版本都被记录在案。

但对**外部爬虫**有价值：

```
时间线：
[创建 issue] → [混淆为"?"] → [删除]
                    ↑
              若爬虫在这个窗口抓取，
              得到的是"?"而非原文
```

对 **Events API** 没有帮助：issue 创建时原始标题已进入事件流，混淆操作会生成新的「edited」事件，但创建事件中的原始标题不会被覆盖。

---

## Force Push 后的残留机制

Force push 只是移动分支指针，旧 commit 对象变为「悬空对象」（dangling objects）：

```
before force push:  main → C3 → C2 → C1
after force push:   main → C3' → C2' → C1'
                           C3 → C2 → C1  ← 悬空，无分支指向
```

攻击者若在 push 前从 Events API 获取了旧 commit SHA，可在 GC 前通过以下 URL 直接访问：
```
https://github.com/<owner>/<repo>/commit/<old-sha>
```

**完全消除的唯一方式**：联系 GitHub Support 请求立即 GC，说明包含 PII（个人身份信息）。

---

## 实际风险评估

对于**小型私有开发项目**中的泄露，实际威胁通常有限：

- Events API：需要知道仓库地址才能查询，随机攻击者不太可能针对性扫描
- 悬空对象：需要知道旧 SHA，而 SHA 只会出现在 Events API 的 push 事件中
- Wayback Machine：小仓库自动抓取频率极低，除非有人手动触发 save

**最不可消除的风险**：已接收邮件通知的仓库关注者——这是设计上无法撤回的。

---

## 何时需要联系 GitHub Support

以下情况建议通过 [GitHub Privacy Request](https://support.github.com/contact/privacy) 请求处理：

1. 泄露内容涉及真实姓名 + 联系方式（手机/邮箱）组合
2. 内容已在外部被截图或引用（确认扩散）
3. 对 90 天 GC 窗口有顾虑，需要立即清除悬空对象
4. 内容已被 Wayback Machine 存档
