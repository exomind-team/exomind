# Team Scheduling（RT-only）

当前开发排班默认基于以下服务：

```text
web-dev       — Vite 前端开发服务器
embedded-rt   — 每台设备各自的 RT SQLite + HTTP runtime
manager       — Tauri Dev Manager（桌面 / Android）
```

## 关键原则

- 不再把 `PouchDB sync server` 作为团队联调前置条件
- 多设备同步主路径固定为：
  - `device pairing`
  - `mesh relay`
  - `signal SSE`
  - `domain projector`
  - `backfill`

## 推荐联调命令

### Web / 桌面

```powershell
bun scripts/dev/tauri-dev-manager.ts start --name desktop --target desktop --web-port 1420 --hmr-port 1421
```

### Android

```powershell
bun scripts/dev/tauri-dev-manager.ts start --name android --target android --web-port 1520 --hmr-port 1521
```

### 查看状态

```powershell
bun scripts/dev/tauri-dev-manager.ts list
```

## 说明

历史文档中关于 `6984 / pouchdb-server.js` 的排班方式已退役，仅作归档参考，不再作为现行团队流程。
