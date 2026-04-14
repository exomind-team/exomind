# ExoMind Ledger 第二台电脑使用指南（独立记账子系统）

> [!note]
> 本文档属于 `exomind-ledger`，即 ExoMind 相关的独立记账子系统。
> 它不是 `exomind-team/exomind` 主软件本体的通用使用文档。
> 文中提到的工作台、账本、同步、草稿，均指这套记账系统。

适用场景：

- 两台电脑共用同一个 GitHub 仓库
- 两边都使用 `exomind-ledger`，而不是在描述 ExoMind 主软件的其他模块
- 账本通过 Git 自动同步

当前账本权威文件：

- `data/ledger/events.jsonl`

## 第一次使用

1. 拉取仓库并切到 `dev`

```powershell
git clone https://github.com/exomind-team/exomind-ledger.git
cd exomind-ledger
git checkout dev
git pull origin dev
```

2. 编译

```powershell
cargo build
```

3. 启动服务

```powershell
cargo run -- serve --addr 127.0.0.1:3789 --web-dir apps/web --extracted-dir .tmp/feishu-extract
```

4. 打开工作台

- `http://127.0.0.1:3789/`

## 日常使用

建议流程：

1. 启动服务并打开工作台
2. 先等待同步状态稳定
3. 正常记账
4. 关闭前确认 Git 同步区没有明显错误

草稿支持三种操作：

- `确认入账`：草稿转正式交易
- `编辑草稿`：草稿退回左侧编辑器，修改后重新生成
- `放弃草稿`：直接删除草稿

## 自动同步规则

- 默认每 `60` 秒自动同步一次
- 本地账本有变化时，会自动尝试提交并推送账本
- 远端只有账本更新时，会自动拉取
- 可以手动点 `立即同步`
- 可以点 `暂停自动同步`

注意：

- 当前自动同步只处理账本，不自动更新代码
- 最稳妥的用法是只通过工作台记账，不在第二台电脑上顺手改代码

## 看到“代码待更新”时

这表示远端除了账本，还有代码变化。系统不会自动更新代码。

处理方式：

1. 停掉本地服务
2. 手动拉代码
3. 重新启动服务

```powershell
git pull origin dev
cargo build
cargo run -- serve --addr 127.0.0.1:3789 --web-dir apps/web --extracted-dir .tmp/feishu-extract
```

## 同步失败时

先看工作台里的 Git 同步区，重点看：

- 当前阶段
- 最近成功时间
- 最近错误
- 是否显示：
  - `本地账本待推送`
  - `远端账本有更新`
  - `远端代码有更新`

优先操作：

1. 先点一次 `立即同步`
2. 如果仍失败，再手动检查：

```powershell
git status
git pull origin dev
git push origin dev
```

## 当前边界

已支持：

- 自动同步账本
- 手动同步
- 暂停/恢复自动同步
- 草稿编辑回退
- 草稿放弃删除

暂不支持：

- 自动更新代码
- 自动合并复杂账本冲突
- 正式交易的完整撤销/冲正流程
