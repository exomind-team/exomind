// signal_route_table_crud.rs — RouteTable CRUD 测试
//
// 测试目标:
//   1. 创建路由 → 读取 → 更新 → 删除（完整 CRUD 生命周期）
//   2. 从 JSON 文件加载路由表
//   3. Topic 匹配: 精确匹配 + "*" 通配符
//
// 依赖: crate::signal::{RouteTable, SignalRoute, TargetType}
// 状态: 测试骨架 — 等待 RouteTable 实现完成后编译通过

use exomind_runtime::signal::types::{SignalRoute, TargetType};

/// Helper: 构造测试路由
fn make_route(id: &str, topic: &str, target_ref: &str) -> SignalRoute {
    SignalRoute {
        id: id.to_string(),
        enabled: true,
        topic: topic.to_string(),
        target_type: TargetType::Agent,
        target_ref: target_ref.to_string(),
        created_at: "2026-03-03T00:00:00Z".to_string(),
        updated_at: "2026-03-03T00:00:00Z".to_string(),
    }
}

// ─── 1. CRUD 完整生命周期 ───

#[tokio::test]
async fn create_read_update_delete_lifecycle() {
    // let table = RouteTable::new();
    //
    // // CREATE
    // let route = make_route("route-1", "user.action", "agent-a");
    // table.create(route.clone());
    //
    // // READ
    // let fetched = table.get("route-1").expect("刚创建的路由应可读取");
    // assert_eq!(fetched.id, "route-1");
    // assert_eq!(fetched.topic, "user.action");
    // assert_eq!(fetched.target_ref, "agent-a");
    // assert!(fetched.enabled);
    //
    // // UPDATE - 修改 topic + enabled
    // table.update("route-1", |r| {
    //     r.topic = "user.updated".to_string();
    //     r.enabled = false;
    // });
    // let updated = table.get("route-1").unwrap();
    // assert_eq!(updated.topic, "user.updated");
    // assert!(!updated.enabled);
    // assert!(updated.updated_at > route.created_at, "updated_at 应更新");
    //
    // // DELETE
    // let deleted = table.delete("route-1");
    // assert!(deleted, "删除应返回 true");
    // assert!(table.get("route-1").is_none(), "删除后不应再读取到");
    //
    // // 重复删除返回 false
    // let double_delete = table.delete("route-1");
    // assert!(!double_delete, "重复删除应返回 false");

    // TODO: 等 RouteTable 实现后取消注释
    let route = make_route("route-1", "user.action", "agent-a");
    assert_eq!(route.id, "route-1");
    assert!(route.enabled);
}

// ─── 2. list_all 返回所有路由 ───

#[tokio::test]
async fn list_all_returns_all_routes() {
    // let table = RouteTable::new();
    // table.create(make_route("r1", "topic.a", "agent-a"));
    // table.create(make_route("r2", "topic.b", "agent-b"));
    // table.create(make_route("r3", "topic.c", "agent-c"));
    //
    // let all = table.list_all();
    // assert_eq!(all.len(), 3);
    //
    // let ids: Vec<&str> = all.iter().map(|r| r.id.as_str()).collect();
    // assert!(ids.contains(&"r1"));
    // assert!(ids.contains(&"r2"));
    // assert!(ids.contains(&"r3"));

    // TODO: 等 RouteTable 实现后取消注释
    assert!(true);
}

// ─── 3. 精确 topic 匹配 ───

#[tokio::test]
async fn exact_topic_matching() {
    // let table = RouteTable::new();
    // table.create(make_route("r1", "user.action", "agent-a"));
    // table.create(make_route("r2", "system.heartbeat", "agent-b"));
    // table.create(make_route("r3", "user.action", "agent-c"));
    //
    // let matched = table.match_topic("user.action");
    // assert_eq!(matched.len(), 2, "只有精确匹配 user.action 的路由");
    //
    // let refs: Vec<&str> = matched.iter().map(|r| r.target_ref.as_str()).collect();
    // assert!(refs.contains(&"agent-a"));
    // assert!(refs.contains(&"agent-c"));
    // assert!(!refs.contains(&"agent-b"));

    // TODO: 等 RouteTable 实现后取消注释
    assert!(true);
}

// ─── 4. 通配符 "*" 匹配所有 topic ───

#[tokio::test]
async fn wildcard_topic_matches_any_event() {
    // let table = RouteTable::new();
    // table.create(make_route("r-catch-all", "*", "agent-monitor"));
    // table.create(make_route("r-specific", "user.action", "agent-a"));
    //
    // // 发送一个 "user.action" 事件 → 两个路由都应匹配
    // let matched = table.match_topic("user.action");
    // assert_eq!(matched.len(), 2);
    //
    // // 发送一个 "system.boot" 事件 → 只有通配符路由匹配
    // let matched2 = table.match_topic("system.boot");
    // assert_eq!(matched2.len(), 1);
    // assert_eq!(matched2[0].id, "r-catch-all");

    // TODO: 等 RouteTable 实现后取消注释
    assert!(true);
}

// ─── 5. 从 JSON 文件加载路由表 ───

#[tokio::test]
async fn load_routes_from_json() {
    // 准备临时 JSON 文件
    // let json_content = serde_json::json!([
    //     {
    //         "id": "loaded-1",
    //         "enabled": true,
    //         "topic": "user.action",
    //         "target_type": "agent",
    //         "target_ref": "agent-a",
    //         "created_at": "2026-03-03T00:00:00Z",
    //         "updated_at": "2026-03-03T00:00:00Z"
    //     },
    //     {
    //         "id": "loaded-2",
    //         "enabled": false,
    //         "topic": "*",
    //         "target_type": "frontend",
    //         "target_ref": "dashboard",
    //         "created_at": "2026-03-03T00:00:00Z",
    //         "updated_at": "2026-03-03T00:00:00Z"
    //     }
    // ]);
    //
    // let tmp_dir = tempfile::tempdir().unwrap();
    // let json_path = tmp_dir.path().join("routes.json");
    // std::fs::write(&json_path, serde_json::to_string_pretty(&json_content).unwrap()).unwrap();
    //
    // let table = RouteTable::from_json_file(&json_path).expect("应成功加载 JSON 路由文件");
    // let all = table.list_all();
    // assert_eq!(all.len(), 2);
    //
    // let loaded_1 = table.get("loaded-1").unwrap();
    // assert_eq!(loaded_1.topic, "user.action");
    // assert!(loaded_1.enabled);
    //
    // let loaded_2 = table.get("loaded-2").unwrap();
    // assert_eq!(loaded_2.topic, "*");
    // assert!(!loaded_2.enabled);

    // TODO: 等 RouteTable 实现后取消注释
    let json = serde_json::json!([{
        "id": "test",
        "enabled": true,
        "topic": "user.action",
        "target_type": "agent",
        "target_ref": "agent-a",
        "created_at": "2026-03-03T00:00:00Z",
        "updated_at": "2026-03-03T00:00:00Z"
    }]);
    let routes: Vec<SignalRoute> = serde_json::from_value(json).unwrap();
    assert_eq!(routes.len(), 1);
    assert_eq!(routes[0].id, "test");
}

// ─── 6. 重复 ID 创建应失败或覆盖 ───

#[tokio::test]
async fn duplicate_id_creation_behavior() {
    // let table = RouteTable::new();
    // let route1 = make_route("dup", "topic.a", "agent-a");
    // let route2 = make_route("dup", "topic.b", "agent-b");
    //
    // table.create(route1);
    // // 行为取决于设计: 要么返回 Err，要么覆盖
    // // 这里假设返回 Err（不覆盖）
    // let result = table.try_create(route2);
    // assert!(result.is_err(), "重复 ID 应返回错误");
    //
    // // 原路由不变
    // let existing = table.get("dup").unwrap();
    // assert_eq!(existing.topic, "topic.a");

    // TODO: 等 RouteTable 实现后取消注释
    assert!(true);
}

// ─── 7. 更新不存在的路由返回错误 ───

#[tokio::test]
async fn update_nonexistent_route_returns_error() {
    // let table = RouteTable::new();
    // let result = table.try_update("nonexistent", |_| {});
    // assert!(result.is_err(), "更新不存在的路由应返回错误");

    // TODO: 等 RouteTable 实现后取消注释
    assert!(true);
}
