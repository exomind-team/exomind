# Today Planner API（今日计划器接口）

本文件记录本轮 `Today Planner（今日计划器）` 的最小可用 RT feature API。

范围只覆盖：

- 手动创建今日计划块
- 计划块类型：`work` / `rest`
- 编辑 / 删除 / 重排
- 从计划块直接开始执行

不覆盖：

- 自动排程
- 自动插入休息
- 通知 / 提醒
- 任务 `plannedStartAt` 大范围建模

## 1. 获取某天计划

```text
GET /act/today-planner?date=YYYY-MM-DD&user_id=<profile-id>
```

示例：

```powershell
curl.exe -sS "http://127.0.0.1:9124/act/today-planner?date=2026-03-26&user_id=profile-argon"
```

返回示例：

```json
{
  "date": "2026-03-26",
  "blocks": [
    {
      "id": "plan-1",
      "date": "2026-03-26",
      "type": "work",
      "title": "Deep Work",
      "plannedStartAt": 1774490400000,
      "plannedDurationMinutes": 50,
      "linkedTaskIds": ["task-a"],
      "order": 0,
      "createdAt": 1774489000000,
      "updatedAt": 1774489000000,
      "status": "pending"
    }
  ]
}
```

`status` 目前有三种：

- `pending`：还没开始
- `active`：已经进入当前执行时间块
- `completed`：已经完成并留下历史时间块

## 2. 创建计划块

```text
POST /act/today-planner/blocks?user_id=<profile-id>
```

示例：

```powershell
curl.exe -sS -X POST "http://127.0.0.1:9124/act/today-planner/blocks?user_id=profile-argon" ^
  -H "Content-Type: application/json" ^
  -d "{\"date\":\"2026-03-26\",\"type\":\"work\",\"title\":\"Deep Work\",\"plannedStartAt\":1774490400000,\"plannedDurationMinutes\":50,\"note\":\"ship vertical slice\",\"linkedTaskIds\":[\"task-a\"]}"
```

`type` 只支持：

- `work`
- `rest`

## 3. 更新计划块

```text
PATCH /act/today-planner/blocks/:blockId?user_id=<profile-id>
```

示例：

```powershell
curl.exe -sS -X PATCH "http://127.0.0.1:9124/act/today-planner/blocks/plan-1?user_id=profile-argon" ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"Lunch + Walk\",\"plannedDurationMinutes\":40,\"note\":null}"
```

说明：

- `note: null` 表示清空备注
- 不传某个字段则保持原值

## 4. 重排计划块

```text
POST /act/today-planner/blocks/reorder?user_id=<profile-id>
```

示例：

```powershell
curl.exe -sS -X POST "http://127.0.0.1:9124/act/today-planner/blocks/reorder?user_id=profile-argon" ^
  -H "Content-Type: application/json" ^
  -d "{\"date\":\"2026-03-26\",\"orderedIds\":[\"plan-2\",\"plan-1\",\"plan-3\"]}"
```

当前前端默认使用“上移 / 下移”按钮，本质也是调用这个接口。

## 5. 从计划块开始执行

```text
POST /act/today-planner/blocks/:blockId/start?user_id=<profile-id>
```

示例：

```powershell
curl.exe -sS -X POST "http://127.0.0.1:9124/act/today-planner/blocks/plan-1/start?user_id=profile-argon"
```

返回值是当前 `active time block（进行中时间块）`，并带上：

- `sourcePlannedBlockId`

这意味着：

- Today Planner 能知道它是从哪个计划块启动的
- 后续结束反馈写回 completed block 时，也能保留这条溯源链

## 6. 删除计划块

```text
DELETE /act/today-planner/blocks/:blockId?user_id=<profile-id>
```

示例：

```powershell
curl.exe -sS -X DELETE "http://127.0.0.1:9124/act/today-planner/blocks/plan-1?user_id=profile-argon"
```

成功返回：

- `204 No Content`

## 7. 当前约束

本轮最重要的契约约束：

- UI 走这套 API
- `curl.exe` 走这套 API
- 后续 ExoMind RT skill / Agent 也走这套 API

也就是说，Today Planner 的核心业务语义已经不再是前端私有逻辑，而是 runtime 的正式 feature API。
