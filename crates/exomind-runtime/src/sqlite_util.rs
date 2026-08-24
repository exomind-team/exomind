//! Shared SQLite connection tuning.
//!
//! 多个 store(signal / eventlog / …)各自 `Connection::open`,历史上没人统一设
//! PRAGMA,导致默认 `journal_mode=DELETE` + `synchronous=FULL`:每次写都要建/删
//! rollback journal 并多次 fsync,在高频写路径(信号 journal、事件 append)上造成
//! 持续高磁盘 I/O。这里把连接调优集中成一个函数,新建库时统一调用即可。
//!
//! 详见 issue #959。

use rusqlite::Connection;

/// Apply the standard durability/throughput tuning for a long-lived local store.
///
/// - `journal_mode = WAL`:写走 WAL,读写并发更好,避免 rollback journal 的反复建删。
/// - `synchronous = NORMAL`:WAL 下足够安全(仅在 checkpoint 时 fsync),把每次写的
///   fsync 次数从 2~3 降到接近 0;桌面本地库可接受(崩溃最多丢最后一个未 checkpoint
///   的事务,不会损坏库)。
/// - `busy_timeout = 5000`:遇到锁竞争等待而非立即报错。
///
/// 幂等:可对同一连接重复调用。
///
/// 调优是纯吞吐优化,**不影响正确性**:`synchronous` / `busy_timeout` 是连接级设置,
/// 只读库也能设;而 `journal_mode = WAL` 需要写库头,若库或目录只读会失败——这种
/// 情况下静默忽略,退回默认日志模式即可,不让一个性能优化把 `open()` 搞挂。
pub fn configure_connection(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "PRAGMA synchronous = NORMAL;\
         PRAGMA busy_timeout = 5000;",
    )?;
    // journal_mode 返回一行结果,必须用 query 消费;只读库会报错,best-effort 忽略。
    if let Err(error) = connection.query_row("PRAGMA journal_mode = WAL;", [], |_| Ok(())) {
        tracing::warn!(
            error = %error,
            "failed to enable WAL journal mode, continuing with default (启用 WAL 失败,沿用默认日志模式)"
        );
    }
    Ok(())
}
