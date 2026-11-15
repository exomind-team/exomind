//! OS discovery sockets share UDP 43343. Loopback unicast has one recipient,
//! so real-controller tests must not steal one another's fixture packets.
use std::sync::{Arc, LazyLock};
static DISCOVERY: LazyLock<Arc<tokio::sync::Mutex<()>>> =
    LazyLock::new(|| Arc::new(tokio::sync::Mutex::new(())));
pub(super) async fn lease() -> tokio::sync::OwnedMutexGuard<()> {
    DISCOVERY.clone().lock_owned().await
}
