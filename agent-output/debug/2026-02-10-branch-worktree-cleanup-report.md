# 本地分支与工作树整理报告（dev-only）

- 生成时间: 2026-02-10 17:03:27 +08:00
- 仓库: D:/project/exomind
- 当前分支: feature/multi-device-sync
- local dev: e0c4035
- origin/dev: e057911
- 结论: dev 本地落后 origin/dev 1 个提交（建议先 git checkout dev && git pull --ff-only）

## 1) 工作树总览

| Path | Branch | Dirty | Changed Files |
|---|---|---:|---:|
| D:/project/exomind | feature/multi-device-sync | DIRTY | 17 |
| C:/Users/starlin/AppData/Local/Temp/vibe-kanban/worktrees/18de-/exomind | vk/18de- | CLEAN | 0 |
| D:/project/exomind-dev-chat | feature/web-p2p | DIRTY | 6 |
| D:/project/exomind-worktrees/feature-icon-dev | hapi-feature-icon-dev | DIRTY | 4 |
| D:/project/exomind_base | (detached) | CLEAN | 0 |
| D:/project/worktrees/feature-event-log-lan | feature/event-log-lan | CLEAN | 0 |

### 脏工作树（删除前必须先处理）
- D:/project/exomind (feature/multi-device-sync): 17 个改动
- D:/project/exomind-dev-chat (feature/web-p2p): 6 个改动
- D:/project/exomind-worktrees/feature-icon-dev (hapi-feature-icon-dev): 4 个改动

## 2) 分支总览（相对 origin/dev）

| Branch | Merged to origin/dev | Ahead | Behind | Has origin branch | In worktree | Upstream |
|---|---:|---:|---:|---:|---|---|
| dev | Y | 0 | 1 | Y | - | origin/dev |
| feature/architecture-review-2026-02-08 | N | 26 | 73 | N | - | - |
| feature/docs-refactor | Y | 0 | 81 | Y | - | origin/feature/docs-refactor |
| feature/event-log-lan | N | 18 | 80 | Y | D:/project/worktrees/feature-event-log-lan | origin/feature/event-log-lan |
| feature/libp2p-integration | Y | 0 | 81 | Y | - | - |
| feature/mobile-websocket-client | N | 54 | 84 | Y | - | origin/feature/mobile-websocket-client |
| feature/multi-device-chat | Y | 0 | 89 | Y | - | - |
| feature/multi-device-sync | N | 21 | 3 | Y | D:/project/exomind | origin/feature/multi-device-sync |
| feature/pairing-crypto | Y | 0 | 81 | Y | - | - |
| feature/refactor-file-storage | N | 4 | 73 | Y | - | - |
| feature/refactor-p2p-connection | Y | 0 | 73 | Y | - | - |
| feature/refactor-websocket | N | 26 | 73 | Y | - | origin/feature/refactor-websocket |
| feature/web-p2p | N | 17 | 80 | Y | D:/project/exomind-dev-chat | origin/feature/web-p2p |
| hapi-feature-icon-dev | Y | 0 | 43 | N | D:/project/exomind-worktrees/feature-icon-dev | - |
| main | Y | 0 | 86 | Y | - | origin/main |
| pr-20 | Y | 0 | 3 | N | - | - |
| vk/18de- | N | 17 | 80 | N | C:/Users/starlin/AppData/Local/Temp/vibe-kanban/worktrees/18de-/exomind | - |
| 功能/v4架构-web-storage-adapter | Y | 0 | 43 | Y | - | - |

## 3) 重复分支（同一提交点）

- b39250b: hapi-feature-icon-dev, 功能/v4架构-web-storage-adapter
- 4d11969: feature/architecture-review-2026-02-08, feature/refactor-websocket
- 85e1a31: feature/web-p2p, vk/18de-
- ace8562: feature/docs-refactor, feature/libp2p-integration, feature/pairing-crypto

## 4) 建议分组（你说只保留 dev 做开发）

### A. 建议保留
- dev
- main

### B. 可立即删除（本地）
- feature/docs-refactor（已并入 origin/dev，且不在任何 worktree）
- feature/libp2p-integration（已并入 origin/dev，且不在任何 worktree）
- feature/multi-device-chat（已并入 origin/dev，且不在任何 worktree）
- feature/pairing-crypto（已并入 origin/dev，且不在任何 worktree）
- feature/refactor-p2p-connection（已并入 origin/dev，且不在任何 worktree）
- pr-20（已并入 origin/dev，且不在任何 worktree）
- 功能/v4架构-web-storage-adapter（已并入 origin/dev，且不在任何 worktree）

### C. 先处理工作树再删
- hapi-feature-icon-dev（已并入 origin/dev，但当前被 worktree 占用）

### D. 暂不建议直接删（未并入 origin/dev）
- feature/architecture-review-2026-02-08（Ahead=26, 可能仅本地/无追踪）
- feature/event-log-lan（Ahead=18, 有远端备份）
- feature/mobile-websocket-client（Ahead=54, 有远端备份）
- feature/multi-device-sync（Ahead=21, 有远端备份）
- feature/refactor-file-storage（Ahead=4, 有远端备份）
- feature/refactor-websocket（Ahead=26, 有远端备份）
- feature/web-p2p（Ahead=17, 有远端备份）
- vk/18de-（Ahead=17, 可能仅本地/无追踪）

## 5) 建议执行顺序（仅建议，未执行删除）
1. 在 D:/project/exomind 处理当前脏改动（提交/暂存/丢弃）。
2. 切到 dev 并快进：git checkout dev && git pull --ff-only。
3. 先删 B 组本地分支。
4. 对 C 组先清理对应 worktree（必要时先处理未提交改动），再删分支。
5. D 组逐个确认是否还需要历史；若不需要再删（优先删有远端备份的）。
