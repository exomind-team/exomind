# Runtime Device Network Phase 2 Design

> **日期**: 2026-04-09
> **状态**: approved-for-implementation（已进入实现）
> **范围**: 在 Phase 1 的 additive contract（增量契约）之上，完成 `device identity（设备身份）` 独立化、`device graph（设备图）` 最小真实返回，以及前端 `Device Network View（设备网络视图） / Signal Topology View（信号拓扑视图）` 的产品收口。

---

## 1. 背景

Phase 1 已经完成：

1. `/topology` 同时暴露 legacy flat fields（旧扁平字段）和 nested foundation contract（新嵌套基础契约）
2. TypeScript client 已支持 dual-read / normalize（双读解析与归一化）
3. UI 已开始通过 topology selectors（拓扑选择器）消费 live topology（实时拓扑）

但 Phase 1 仍然保留几个明显缺口：

1. `device.id` 仍 alias（别名）到 `host_id`
2. `device_components / device_links` 仍是空数组占位
3. 前端仍以 `RuntimeHostSnapshot` 为中心，尚未形成真正的 `device snapshot（设备快照）`
4. 产品语义上虽然已有“设备页”和“拓扑图”，但还没显式收口成“两张视图，一张底层网”

## 2. 设计目标

Phase 2 只解决三个问题，不扩散：

1. 让 `Device` 拥有独立稳定身份，不再把 `host_id` 当成设备主键
2. 让 Runtime 真正返回最小可辩护的 `device_components / device_links`
3. 让前端从同一份底层数据中派生：
   - `Device Network View（设备网络视图）`
   - `Signal Topology View（信号拓扑视图）`

## 3. 非目标

本阶段明确不做：

1. 完整硬件资产平台
2. 全量 `DeviceComponent -> Actor` 自动升格
3. 完整 relay（中继）链路可视化
4. 前端独立设备数据库或新的持久化仓库
5. 多 `RuntimeHost` 归属同一 `Device` 的复杂编排界面

## 4. 关键判断

### 4.1 `device_id` 独立于 `host_id`

后端新增独立持久化键，例如：

- `exomind:runtimeHostId`
- `exomind:deviceId`

语义区分：

1. `host_id`
   - 表示一个 `RuntimeHost` 实例的稳定身份
2. `device_id`
   - 表示一个 `Device` 实体的稳定身份

第一版仍然采用 1:1 关系：

- 一个 `RuntimeHost` 对应一个主 `Device`

但不再复用同一个 ID，这样后续“一台设备多个 runtime host”才有演化空间。

### 4.2 `device graph` 采用最小真实枚举

Phase 2 不伪造复杂硬件细节，只返回 defendable（可自洽、可论证）的最小图：

1. `device`
   - 表示当前设备实体
2. `device_components`
   - 至少包含 `runtime-host` 这个部件
3. `device_links`
   - 至少包含 `device -> runtime_host_component` 这条部件归属链路

这样做的意义：

1. 前端能开始消费“设备图”
2. 协议不再只有壳
3. 不会因为伪造 CPU / NIC / disk 等细节引入错误语义

### 4.3 前端不新建独立设备仓库

Phase 2 前端采用“host snapshots 派生 device snapshots”的路线：

1. `RuntimeHostRecord` 仅补 `deviceId?: string`
2. `RuntimeManager` 继续维护 `hosts`
3. `RuntimeManager` 新增派生结果 `devices`
4. `DeviceView` 消费 `device snapshots`

这样做的好处：

1. 不打散现有 host pairing / polling / auth 流
2. 避免再造一套状态同步逻辑
3. 符合“底层一张网，视图分离”的原则

## 5. 数据模型增量

### 5.1 后端

`/topology` 返回结构保持 additive contract，不删旧字段，但补强新字段：

```json
{
  "host_id": "rt-xxx",
  "runtime_host": {
    "host_id": "rt-xxx"
  },
  "device": {
    "id": "dev-yyy",
    "primary_runtime_host_id": "rt-xxx"
  },
  "device_components": [
    {
      "id": "dev-yyy:runtime-host",
      "device_id": "dev-yyy",
      "kind": "runtime_host",
      "name": "Runtime Host",
      "status": "online",
      "runtime_host_id": "rt-xxx"
    }
  ],
  "device_links": [
    {
      "id": "dev-yyy:owns:runtime-host",
      "source_kind": "device",
      "source_id": "dev-yyy",
      "target_kind": "device_component",
      "target_id": "dev-yyy:runtime-host",
      "transport": "ownership",
      "status": "online"
    }
  ]
}
```

### 5.2 前端

`RuntimeHostRecord` 增加：

```ts
deviceId?: string; // device_id（设备 ID）
```

`RuntimeManagerSnapshot` 增加：

```ts
devices: RuntimeDeviceSnapshot[];
```

最小 `RuntimeDeviceSnapshot`：

```ts
type RuntimeDeviceSnapshot = {
  id: string;
  name: string;
  kind: RuntimeTopologyDeviceKind;
  primaryHostId?: string;
  runtimeHosts: RuntimeHostSnapshot[];
  components: RuntimeTopologyDeviceComponent[];
  links: RuntimeTopologyDeviceLink[];
  connectionState: 'online' | 'error' | 'offline';
};
```

## 6. UI 收口

### 6.1 两张视图，一张底层网

产品上显式区分：

1. `Device Network View`
   - 展示 `Device / RuntimeHost / DeviceComponent / DeviceLink`
2. `Signal Topology View`
   - 展示 `Actor / Agent / SignalRoute / SignalGraph`

第一版实现上不强行重做整个页面布局，而是：

1. 把现有 `device` tab 的文案、结构、数据源收口为“设备网络”
2. 把现有 `topology` tab 的文案收口为“信号拓扑”

### 6.2 `DeviceView` 的目标

`DeviceView` 在本阶段要做到：

1. 顶部明确显示这是 `设备网络视图`
2. 本机与远端 peer 的展示主语从 `host` 改为 `device`
3. 显示至少一个真实部件：`runtime-host`
4. 显示部件数量、链路数量、主宿主等聚合信息

## 7. 测试策略

需要覆盖三层：

1. Rust
   - `device_id` 持久化稳定
   - `/topology` 返回独立 `device.id`
   - `/topology` 返回最小真实 `device_components / device_links`
2. TypeScript / 服务层
   - `runtime-client` 解析真实 component/link
   - `runtime-host.service` 持久化 `deviceId`
   - `runtime-manager` 产出 `devices`
3. React / E2E
   - 设备页显示 `Device Network`
   - 信号页显示 `Signal Topology`
   - 设备卡片显示独立 `device id`
   - 设备部件与链路摘要可见

## 8. 验收标准

完成后必须满足：

1. Runtime 重启后 `host_id` 稳定、`device_id` 也稳定，但两者不相等
2. `/topology.device.id !== /topology.host_id`
3. `/topology.device_components.length >= 1`
4. `/topology.device_links.length >= 1`
5. 前端 `RuntimeHostRecord` 能记住 `deviceId`
6. `RuntimeManagerSnapshot.devices.length >= 1`
7. UI 顶层明确存在：
   - `设备网络`
   - `信号拓扑`
8. TS / Rust / Playwright 验证通过

## 9. 风险与控制

### 风险 1: 设备身份迁移打断现有配对逻辑

控制：

1. 仅新增 `deviceId`
2. 不改变现有 `hostId` 的使用语义
3. peer pairing 继续以 `hostId` 为主

### 风险 2: `device_components` 设计过重

控制：

1. 第一版只返回 `runtime_host` 组件
2. 不伪造 CPU / 磁盘 / 网卡等复杂资产

### 风险 3: UI 范围膨胀

控制：

1. 不重做整页信息架构
2. 只把当前 `device/topology` 两个 tab 明确语义化
3. 只新增最小设备快照派生层
