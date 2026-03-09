# Worker Agent PR Lifecycle

## Draft PR Gate

在开始实质开发前，必须满足这四个门槛：

1. 已创建分支。
2. 已有首个提交。
3. 已创建 draft PR。
4. 已写好 PR body，并在拿到 PR 号后上锁。

## Lock Lifecycle

`Worker Agent` 对当前 PR 的绑定，依赖现有 `PR 锁系统`。

规则：

- 创建 draft PR 后立即上锁。
- 每轮循环开始先验证锁归属。
- 本地 `temp/worker-agent/lock/current-lock.json` 只是缓存。
- 远程锁状态才是主真相源。

## PR Body Sync Rule

每次准备提交或推送前，必须检查 PR body 是否仍然准确对应：

- 当前代码范围
- 当前验证策略
- 当前关联 issue

若不准确，先同步 PR body，再继续提交。

## Exit Conditions

只有下列情况才释放锁：

- PR 已合并
- PR 已关闭
- 人工明确要求放弃当前 PR

默认不做超时自动释放。
