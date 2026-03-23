mod support;

use std::time::Duration;
use support::{runtime_base_url, start_test_runtime_with_mdns, stop_runtime};

/// Two MdnsDiscovery instances on the same machine should discover each other.
///
/// Marked `#[ignore]` because mDNS requires multicast networking support
/// which may not be available in CI environments.
#[tokio::test]
#[ignore]
async fn two_runtimes_discover_each_other_via_mdns() {
    let mut rt_a = start_test_runtime_with_mdns("mdns-test-a").await;
    let mut rt_b = start_test_runtime_with_mdns("mdns-test-b").await;

    // Give mDNS some time to discover peers (typically < 2 seconds on LAN).
    tokio::time::sleep(Duration::from_secs(3)).await;

    // Query the /mesh/discovered endpoint on each runtime.
    let client = reqwest::Client::new();

    let discovered_by_a: Vec<serde_json::Value> = client
        .get(format!("{}/mesh/discovered", runtime_base_url(&rt_a)))
        .send()
        .await
        .expect("GET /mesh/discovered on rt_a should succeed")
        .json()
        .await
        .expect("response should be valid JSON");

    let discovered_by_b: Vec<serde_json::Value> = client
        .get(format!("{}/mesh/discovered", runtime_base_url(&rt_b)))
        .send()
        .await
        .expect("GET /mesh/discovered on rt_b should succeed")
        .json()
        .await
        .expect("response should be valid JSON");

    // rt_a should see rt_b.
    assert!(
        discovered_by_a
            .iter()
            .any(|peer| peer["host_id"] == "mdns-test-b"),
        "rt_a should discover rt_b, got: {discovered_by_a:?}"
    );

    // rt_b should see rt_a.
    assert!(
        discovered_by_b
            .iter()
            .any(|peer| peer["host_id"] == "mdns-test-a"),
        "rt_b should discover rt_a, got: {discovered_by_b:?}"
    );

    stop_runtime(&mut rt_a, "mdns-test-a").await;
    stop_runtime(&mut rt_b, "mdns-test-b").await;
}

/// When mDNS is disabled, /mesh/discovered returns an empty list.
#[tokio::test]
async fn discovered_returns_empty_when_mdns_disabled() {
    let mut rt = support::start_test_runtime("mdns-disabled").await;

    let client = reqwest::Client::new();
    let discovered: Vec<serde_json::Value> = client
        .get(format!("{}/mesh/discovered", runtime_base_url(&rt)))
        .send()
        .await
        .expect("GET /mesh/discovered should succeed")
        .json()
        .await
        .expect("response should be valid JSON");

    assert!(
        discovered.is_empty(),
        "discovered peers should be empty when mDNS is disabled, got: {discovered:?}"
    );

    stop_runtime(&mut rt, "mdns-disabled").await;
}
