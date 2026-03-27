# Today Planner API（今日计划器接口）

本文件记录本轮 `Today Planner / 今日计划` 的 runtime API 合同。

本轮范围只覆盖：

- 手动框选一个 `Scheduling Window / 可调度区间`
- 按 `Rhythm Preset / 节奏预设` 自动生成工作片段与休息窗
- 只允许 `work / 工作片段` 关联任务、开始执行
- 只对当前区间做 `reflow / 重算`

本轮不覆盖：

- MCP skill 接线
- AI 自动排整天日程
- 多个区间之间的全局重排

## 1. 获取某天计划快照

```text
GET /act/today-planner?date=YYYY-MM-DD&user_id=<profile-id>
```

示例：

```powershell
curl.exe -sS "http://127.0.0.1:9124/act/today-planner?date=2026-03-27&user_id=profile-argon"
```

返回示例：

```json
{
  "date": "2026-03-27",
  "windows": [
    {
      "id": "window-1",
      "date": "2026-03-27",
      "title": "Morning Focus",
      "plannedStartAt": 1774573600000,
      "plannedEndAt": 1774577200000,
      "rhythmPreset": {
        "key": "pomodoro_25_5",
        "label": "25 / 5",
        "workMinutes": 25,
        "shortBreakMinutes": 5,
        "longBreakMinutes": 20,
        "longBreakAfterWorkSegments": 4
      },
      "segments": [
        {
          "id": "segment-work-1",
          "windowId": "window-1",
          "kind": "work",
          "title": "Work 1",
          "plannedStartAt": 1774573600000,
          "plannedEndAt": 1774575100000,
          "linkedTaskIds": [],
          "order": 0,
          "createdAt": 1774570000000,
          "updatedAt": 1774570000000,
          "status": "pending"
        },
        {
          "id": "segment-break-1",
          "windowId": "window-1",
          "kind": "break",
          "breakKind": "short",
          "title": "Short Break",
          "plannedStartAt": 1774575100000,
          "plannedEndAt": 1774575400000,
          "linkedTaskIds": [],
          "order": 1,
          "createdAt": 1774570000000,
          "updatedAt": 1774570000000,
          "status": "pending"
        }
      ],
      "createdAt": 1774570000000,
      "updatedAt": 1774570000000
    }
  ]
}
```

`status` 当前有三种：

- `pending`：还没开始
- `active`：已经开始执行，对应 runtime 里存在 active time block
- `completed`：已完成，并能回溯到历史 time block

## 2. 创建可调度区间

```text
POST /act/today-planner/windows?user_id=<profile-id>
```

示例：

```powershell
curl.exe -sS -X POST "http://127.0.0.1:9124/act/today-planner/windows?user_id=profile-argon" ^
  -H "Content-Type: application/json" ^
  -d "{\"date\":\"2026-03-27\",\"title\":\"Morning Focus\",\"plannedStartAt\":1774573600000,\"plannedEndAt\":1774577200000,\"rhythmPresetKey\":\"pomodoro_25_5\"}"
```

说明：

- 创建的是一个大区间，不是单个工作块
- runtime 会立刻根据预设自动生成内部 `segments`
- 当前支持的 `rhythmPresetKey`：
  - `pomodoro_25_5`
  - `focus_45_10`
  - `focus_45_15`

## 3. 更新工作片段

```text
PATCH /act/today-planner/segments/:segmentId?user_id=<profile-id>
```

示例：

```powershell
curl.exe -sS -X PATCH "http://127.0.0.1:9124/act/today-planner/segments/segment-work-1?user_id=profile-argon" ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"Deep Work A\",\"linkedTaskIds\":[\"task-a\",\"task-b\"]}"
```

说明：

- 只允许更新 `work / 工作片段`
- `break / 休息窗` 不允许挂任务
- 不传字段就保持原值

## 4. 从工作片段开始执行

```text
POST /act/today-planner/segments/:segmentId/start?user_id=<profile-id>
```

示例：

```powershell
curl.exe -sS -X POST "http://127.0.0.1:9124/act/today-planner/segments/segment-work-1/start?user_id=profile-argon"
```

返回值是当前 `active time block / 进行中时间块`，并带上：

- `sourcePlannedBlockId`
- `taskIds`

这意味着：

- Today Planner 的工作片段能和真实执行中的 time block 建立来源链
- 后续完成后的历史时间块也能继续追溯回这个片段

## 5. 重算当前可调度区间

```text
POST /act/today-planner/windows/:windowId/reflow?user_id=<profile-id>
```

示例：

```powershell
curl.exe -sS -X POST "http://127.0.0.1:9124/act/today-planner/windows/window-1/reflow?user_id=profile-argon" ^
  -H "Content-Type: application/json" ^
  -d "{\"anchorSegmentId\":\"segment-work-1\",\"actualEndAt\":1774575300000}"
```

说明：

- `anchorSegmentId` 是你刚刚实际结束的那个工作片段
- `actualEndAt` 是实际结束时刻（毫秒时间戳）
- 当前实现只平移这个 `window / 可调度区间` 里后续剩余片段
- 不会影响其他区间

## 6. 当前契约约束

本轮最重要的接口约束：

- 前端 Today Planner 走这套 API
- `curl.exe` 走这套 API
- 后续 MCP/Skill 接线也应该复用这套 runtime contract

也就是说，Today Planner 已经不是前端私有排表逻辑，而是 runtime 的正式 feature API。
