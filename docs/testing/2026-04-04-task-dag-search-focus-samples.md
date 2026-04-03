# Task DAG 联合搜索 / 聚焦系列手测样例

## 目标

为 `/tasks/dag` 提供一组可重复执行的 RT 样例任务，专门用于手测：

- 文本搜索 + 标签搜索的联合 `AND`
- 标签内部 `and/or` 切换
- `过滤` 开关对统一搜索结果的硬隐藏
- `聚焦系列` 在两个不连通系列之间的弱化表现
- `描述` 搜索与标签搜索的联合命中

## Seed 脚本

```bash
bun scripts/dev/seed-task-dag-search-focus-examples.ts --host 127.0.0.1 --port 9124 --user-id anonymous
```

也可以直接传完整 RT 地址：

```bash
bun scripts/dev/seed-task-dag-search-focus-examples.ts --base-url http://127.0.0.1:9124 --user-id anonymous
```

脚本特性：

- 只调用 RT HTTP `/tasks/replication/upsert`
- 使用固定 task id，可重复执行，不会不断堆重复样例
- 只会写入带 `sample` 标签的样例任务，不触碰同 scope 下其他已有任务

## 样例结构

两组主要系列：

- 主线系列
  - `样例/DAG 搜索主线：Batch Q DAG 基线`
  - `样例/DAG 搜索主线：Batch Q DAG 联合搜索验收`
  - `样例/DAG 搜索主线：Batch Q 标签收尾`
  - `样例/DAG 搜索主线：Batch Q 聚焦系列主链`
- 旁系列
  - `样例/DAG 旁系：Batch Q 聚焦系列 X`
  - `样例/DAG 旁系：Batch Q 聚焦系列 Y`

配套负例：

- `样例/Batch Q 文本命中但标签不命中`
- `样例/后端 DAG 标签命中但文本不命中`
- `样例/前端节点`
- `样例/后端节点`
- `样例/前端 DAG`
- `样例/RT 联通回归`

状态覆盖：

- `样例/DAG 搜索主线：Batch Q 标签收尾` 是 `completed`
- `样例/DAG 搜索主线：Batch Q 聚焦系列主链` 是 `in_progress`

## 推荐手测动作

1. 文本输入 `Batch Q`，再点标签 `dag`
   - 预期：两条 DAG 系列同时命中；文本-only、tag-only、RT 样例都弱化

2. 在上一步基础上开启 `过滤`
   - 预期：只剩命中 `Batch Q` + `dag` 的节点；非命中节点硬隐藏

3. 在上一步基础上右键 `样例/DAG 搜索主线：Batch Q 聚焦系列主链`，点击 `聚焦此系列`
   - 预期：主线系列保持正常；旁系 `X/Y` 弱化；已经被过滤隐藏的节点不会被带回

4. 清空搜索；选择标签 `dag` + `focus`
   - 预期：默认标签内部 `and` 只命中带 `dag` 和 `focus` 的节点

5. 在上一步点击标签匹配模式切到 `or`
   - 预期：命中范围扩大到仅带 `dag` 或仅带 `focus` 的相关样例

6. 文本输入 `Markdown`，开启 `描述`，再点标签 `frontend`
   - 预期：只命中 `样例/前端节点`

## 备注

如果 DAG 页面在 seed 前就已经打开，seed 完成后刷新一次页面，确保重新从外部 RT 拉取任务列表。
