use exomind_beta_host::{BetaHost, GrantKind, GrantRequest, Session, serve};
use exomind_core::{AgentId, ProfileId};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

const CHUNK: usize = 256 * 1024;

fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

fn grant(host: &BetaHost, owner: &Session, profile: ProfileId, kind: GrantKind) -> String {
    host.grant(
        owner,
        GrantRequest {
            profile_id: profile,
            kind,
            agent_id: (kind == GrantKind::AgentNote).then(AgentId::new),
        },
    )
    .unwrap()
    .token
}

fn metadata(bytes: &[u8]) -> Value {
    json!({"original_id": Uuid::new_v4(), "expected_sha256": format!("{:x}", Sha256::digest(bytes)),
        "byte_length": bytes.len(), "file_name": "synthetic.bin", "media_type": "application/octet-stream"})
}

async fn begin(http: &reqwest::Client, path: &str, token: &str, metadata: &Value) -> Value {
    let response = http
        .put(path)
        .bearer_auth(token)
        .json(metadata)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200, "stage begin must be implemented");
    response.json().await.unwrap()
}

async fn upload(http: &reqwest::Client, path: &str, token: &str, bytes: &[u8]) -> Value {
    let mut status = Value::Null;
    for (index, chunk) in bytes.chunks(CHUNK).enumerate() {
        let response = http
            .put(format!("{path}/chunks?offset={}", index * CHUNK))
            .bearer_auth(token)
            .header("content-type", "application/octet-stream")
            .body(chunk.to_vec())
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        status = response.json().await.unwrap();
    }
    status
}

#[tokio::test]
async fn real_http_originals_are_private_until_whole_group_capture_and_retry_is_exact() {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("beta")).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    let other = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic originals")
        .unwrap();
    host.provision_profile(&owner, other, "synthetic other")
        .unwrap();
    let human = grant(&host, &owner, profile, GrantKind::Human);
    let observer = grant(&host, &owner, profile, GrantKind::Observer);
    let agent = grant(&host, &owner, profile, GrantKind::AgentNote);
    let wrong_profile = grant(&host, &owner, other, GrantKind::Human);
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let base = format!("http://{}/beta/v1", server.addr());
    let http = client();
    let hello: Value = http
        .get(format!("{base}/hello"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(hello["capabilities"]["originals"], true);
    assert_eq!(hello["capabilities"]["max_original_chunk_bytes"], CHUNK);
    let bytes: Vec<u8> = (0..CHUNK + 193).map(|index| (index % 251) as u8).collect();
    let meta_a = metadata(&bytes);
    let meta_b = metadata(b"second exact original");
    let stage_a = Uuid::new_v4();
    let stage_b = Uuid::new_v4();
    let path_a = format!("{base}/profiles/{profile}/stages/{stage_a}");
    let path_b = format!("{base}/profiles/{profile}/stages/{stage_b}");
    for token in [&observer, &wrong_profile] {
        assert_eq!(
            http.put(&path_a)
                .bearer_auth(token)
                .json(&meta_a)
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    assert_eq!(
        http.put(&path_a)
            .json(&meta_a)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    let mut forged = meta_a.clone();
    forged["author_id"] = json!("do-not-echo-private-author");
    let rejection = http
        .put(&path_a)
        .bearer_auth(&human)
        .json(&forged)
        .send()
        .await
        .unwrap();
    assert_eq!(rejection.status(), 400);
    assert!(
        !rejection
            .text()
            .await
            .unwrap()
            .contains("do-not-echo-private-author")
    );
    assert_eq!(
        begin(&http, &path_a, &human, &meta_a).await["next_offset"],
        0
    );
    assert_eq!(
        begin(&http, &path_a, &human, &meta_a).await["next_offset"],
        0
    );
    let status = upload(&http, &path_a, &human, &bytes).await;
    assert_eq!(status["next_offset"], bytes.len());
    // A lost chunk acknowledgement can repeat the identical bytes; changed bytes conflict.
    assert_eq!(
        http.put(format!("{path_a}/chunks?offset=0"))
            .bearer_auth(&human)
            .header("content-type", "application/octet-stream")
            .body(bytes[..CHUNK].to_vec())
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        http.put(format!("{path_a}/chunks?offset=0"))
            .bearer_auth(&human)
            .header("content-type", "application/octet-stream")
            .body(vec![255; CHUNK])
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    for token in [&observer, &agent, &wrong_profile] {
        assert_eq!(
            http.get(&path_a)
                .bearer_auth(token)
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        assert_eq!(
            http.get(format!("{path_a}/bytes?offset=0&length=17"))
                .bearer_auth(token)
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    let preview = http
        .get(format!("{path_a}/bytes?offset={}&length=193", CHUNK))
        .bearer_auth(&human)
        .send()
        .await
        .unwrap();
    assert_eq!(preview.status(), 200);
    assert_eq!(preview.bytes().await.unwrap().as_ref(), &bytes[CHUNK..]);
    begin(&http, &path_b, &human, &meta_b).await;
    upload(&http, &path_b, &human, b"second exact original").await;
    let verified_a: Value = http
        .post(format!("{path_a}/verify"))
        .bearer_auth(&human)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(verified_a["state"], "verified");
    let original_a = verified_a["original"].clone();
    let committed_a = format!(
        "{base}/profiles/{profile}/originals/{}/bytes?offset=0&length=37",
        meta_a["original_id"].as_str().unwrap()
    );
    assert_eq!(
        http.get(&committed_a)
            .bearer_auth(&observer)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let command = json!({"command_id":Uuid::new_v4(), "event_id":Uuid::new_v4(), "profile_id":profile,
        "occurred_at_ms":1, "text":"synthetic complete group", "tags":[],
        "originals":[original_a, {"original_id":meta_b["original_id"], "sha256":meta_b["expected_sha256"],
            "byte_length":meta_b["byte_length"], "file_name":meta_b["file_name"], "media_type":meta_b["media_type"]}]});
    assert_eq!(
        http.post(format!("{base}/capture"))
            .bearer_auth(&human)
            .json(&command)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    let empty: Value = http
        .get(format!("{base}/profiles/{profile}/events"))
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(empty["items"].as_array().unwrap().len(), 0);
    assert_eq!(
        http.post(format!("{path_b}/verify"))
            .bearer_auth(&human)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    let response = http
        .post(format!("{base}/capture"))
        .bearer_auth(&human)
        .json(&command)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let receipt: Value = response.json().await.unwrap();
    let replay: Value = http
        .post(format!("{base}/capture"))
        .bearer_auth(&human)
        .json(&command)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(replay["replayed"], true);
    assert_eq!(replay["event_digest"], receipt["event_digest"]);
    let page: Value = http
        .get(format!("{base}/profiles/{profile}/events"))
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(page["items"][0]["originals"].as_array().unwrap().len(), 2);
    let read = http
        .get(&committed_a)
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap();
    assert_eq!(read.status(), 200);
    assert_eq!(read.bytes().await.unwrap().as_ref(), &bytes[..37]);
    assert_eq!(
        http.get(&committed_a)
            .bearer_auth(&wrong_profile)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    server.stop().await.unwrap();
}

#[tokio::test]
async fn real_http_hash_mismatch_keeps_bytes_and_refuses_sealing_or_capture() {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("beta")).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic mismatch")
        .unwrap();
    let human = grant(&host, &owner, profile, GrantKind::Human);
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let path = format!(
        "http://{}/beta/v1/profiles/{profile}/stages/{}",
        server.addr(),
        Uuid::new_v4()
    );
    let http = client();
    let meta = metadata(b"good");
    begin(&http, &path, &human, &meta).await;
    upload(&http, &path, &human, b"evil").await;
    let failed = http
        .post(format!("{path}/verify"))
        .bearer_auth(&human)
        .send()
        .await
        .unwrap();
    assert_eq!(failed.status(), 409);
    assert_eq!(
        failed.json::<Value>().await.unwrap()["error"]["code"],
        "original_hash_mismatch"
    );
    let status: Value = http
        .get(&path)
        .bearer_auth(&human)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["state"], "hash_mismatch");
    let bytes = http
        .get(format!("{path}/bytes?offset=0&length=4"))
        .bearer_auth(&human)
        .send()
        .await
        .unwrap();
    assert_eq!(bytes.status(), 200);
    assert_eq!(bytes.bytes().await.unwrap().as_ref(), b"evil");
    assert_eq!(
        http.post(format!("{path}/verify"))
            .bearer_auth(&human)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    server.stop().await.unwrap();
}

#[tokio::test]
async fn real_http_original_chunk_and_range_bounds_are_enforced() {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("beta")).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic bounds")
        .unwrap();
    let human = grant(&host, &owner, profile, GrantKind::Human);
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let path = format!(
        "http://{}/beta/v1/profiles/{profile}/stages/{}",
        server.addr(),
        Uuid::new_v4()
    );
    let http = client();
    begin(&http, &path, &human, &metadata(&vec![0; CHUNK + 1])).await;
    assert_eq!(
        http.put(format!("{path}/chunks?offset=0"))
            .bearer_auth(&human)
            .header("content-type", "application/octet-stream")
            .body(vec![0; CHUNK + 1])
            .send()
            .await
            .unwrap()
            .status(),
        413
    );
    for query in [
        "offset=18446744073709551616",
        "offset=-1",
        "offset=0&extra=1",
    ] {
        assert_eq!(
            http.put(format!("{path}/chunks?{query}"))
                .bearer_auth(&human)
                .header("content-type", "application/octet-stream")
                .body(vec![0])
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
    }
    for length in [0, CHUNK + 1] {
        assert_eq!(
            http.get(format!("{path}/bytes?offset=0&length={length}"))
                .bearer_auth(&human)
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
    }
    server.stop().await.unwrap();
}

#[tokio::test]
async fn real_http_interrupted_upload_resumes_after_restart_with_the_original_stage_and_grant() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("beta");
    let host = Arc::new(BetaHost::open(&root).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic resume")
        .unwrap();
    let human = grant(&host, &owner, profile, GrantKind::Human);
    let stage = Uuid::new_v4();
    let meta = metadata(b"01234567");
    let http = client();
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let path = format!(
        "http://{}/beta/v1/profiles/{profile}/stages/{stage}",
        server.addr()
    );
    begin(&http, &path, &human, &meta).await;
    upload(&http, &path, &human, b"0123").await;
    server.stop().await.unwrap();
    drop(host);
    let host = Arc::new(BetaHost::open(&root).unwrap());
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let path = format!(
        "http://{}/beta/v1/profiles/{profile}/stages/{stage}",
        server.addr()
    );
    assert_eq!(begin(&http, &path, &human, &meta).await["next_offset"], 4);
    assert_eq!(
        http.put(format!("{path}/chunks?offset=4"))
            .bearer_auth(&human)
            .header("content-type", "application/octet-stream")
            .body(b"4567".to_vec())
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        http.post(format!("{path}/verify"))
            .bearer_auth(&human)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        http.post(format!("{path}/verify"))
            .bearer_auth(&human)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    server.stop().await.unwrap();
}
