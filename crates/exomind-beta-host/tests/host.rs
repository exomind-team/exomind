use exomind_beta_host::{
    BetaHost, GrantKind, GrantRequest, HostError, RunningServer, Session, serve,
    serve_with_frontend_origins,
};
use exomind_core::{AgentId, CaptureCommand, CommandId, EventId, EventQuery, ProfileId};
use serde_json::{Value, json};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::Path,
    sync::Arc,
};
use tempfile::TempDir;

fn loopback() -> SocketAddr {
    SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0)
}
fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
}
fn token(root: &Path) -> String {
    serde_json::from_slice::<Value>(&std::fs::read(root.join("connection.beta.json")).unwrap())
        .unwrap()["owner_token"]
        .as_str()
        .unwrap()
        .to_owned()
}
fn command(profile: ProfileId, text: &str) -> CaptureCommand {
    CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        occurred_at_ms: 1794560000000,
        text: text.into(),
        tags: vec!["synthetic".into()],
    }
}
fn local(host: &BetaHost, owner: &Session, profile: ProfileId, kind: GrantKind) -> String {
    host.grant(
        owner,
        GrantRequest {
            profile_id: profile,
            kind,
            agent_id: if kind == GrantKind::AgentNote {
                Some(AgentId::new())
            } else {
                None
            },
        },
    )
    .unwrap()
    .token
}
async fn start() -> (TempDir, Arc<BetaHost>, RunningServer, String) {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("beta")).unwrap());
    let server = serve(host.clone(), loopback()).await.unwrap();
    let url = format!("http://{}", server.addr());
    (directory, host, server, url)
}

#[test]
fn public_capabilities_are_send_sync_and_sessions_clone() {
    fn send_sync<T: Send + Sync>() {}
    send_sync::<BetaHost>();
    send_sync::<RunningServer>();
    send_sync::<Session>();
    fn clonable<T: Clone>() {}
    clonable::<Session>();
}

#[tokio::test]
async fn real_http_authentication_scope_author_and_receipts() {
    let (_directory, host, server, url) = start().await;
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic")
        .unwrap();
    let other = ProfileId::new();
    host.provision_profile(&owner, other, "same name").unwrap();
    let observer = local(&host, &owner, profile, GrantKind::Observer);
    let human = local(&host, &owner, profile, GrantKind::Human);
    let agent = local(&host, &owner, profile, GrantKind::AgentNote);
    let http = client();
    let hello: Value = http
        .get(format!("{url}/beta/v1/hello"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(hello["protocol"], "exomind-beta/1");
    assert!(hello.get("profiles").is_none());
    assert!(hello.get("owner_token").is_none());
    let input = command(profile, "PRIVATE_SYNTHETIC_TEXT");
    assert_eq!(
        http.post(format!("{url}/beta/v1/capture"))
            .json(&input)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        http.post(format!("{url}/beta/v1/capture"))
            .bearer_auth(&observer)
            .json(&input)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let response: Value = http
        .post(format!("{url}/beta/v1/capture"))
        .bearer_auth(&agent)
        .json(&input)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(response["durability"], "local_committed");
    let replay: Value = http
        .post(format!("{url}/beta/v1/capture"))
        .bearer_auth(&agent)
        .json(&input)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(replay["replayed"], true);
    let page: Value = http
        .get(format!("{url}/beta/v1/profiles/{profile}/events"))
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(page["items"][0]["author_kind"], "agent_note");
    assert_eq!(
        http.get(format!("{url}/beta/v1/profiles/{other}/events"))
            .bearer_auth(&observer)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let mut forged = serde_json::to_value(command(profile, "DO_NOT_ECHO")).unwrap();
    forged["author_kind"] = json!("human");
    let failure = http
        .post(format!("{url}/beta/v1/capture"))
        .bearer_auth(&agent)
        .json(&forged)
        .send()
        .await
        .unwrap();
    assert_eq!(failure.status(), 400);
    let failure = failure.text().await.unwrap();
    assert!(!failure.contains("DO_NOT_ECHO"));
    assert!(!failure.contains(&agent));
    let mut changed = input.clone();
    changed.text = "changed".into();
    assert_eq!(
        http.post(format!("{url}/beta/v1/capture"))
            .bearer_auth(&agent)
            .json(&changed)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    // A human session cannot replay the agent's already-bound command ID.
    assert_eq!(
        http.post(format!("{url}/beta/v1/capture"))
            .bearer_auth(&human)
            .json(&input)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    assert_eq!(
        http.get(format!(
            "{url}/beta/v1/profiles/{profile}/receipts/{}",
            input.command_id
        ))
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap()
        .status(),
        200
    );
    server.stop().await.unwrap();
}

#[tokio::test]
async fn owner_management_is_authenticated_and_profile_provision_is_idempotent() {
    let (directory, host, server, url) = start().await;
    let raw_owner = token(&directory.path().join("beta"));
    let http = client();
    let profile = ProfileId::new();
    assert_eq!(
        http.get(format!("{url}/beta/v1/profiles"))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    for _ in 0..2 {
        assert_eq!(
            http.put(format!("{url}/beta/v1/profiles/{profile}"))
                .bearer_auth(&raw_owner)
                .json(&json!({"name":"same"}))
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
    }
    assert_eq!(
        http.put(format!("{url}/beta/v1/profiles/{profile}"))
            .bearer_auth(&raw_owner)
            .json(&json!({"name":"changed"}))
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    let grant: Value = http
        .post(format!("{url}/beta/v1/grants"))
        .bearer_auth(&raw_owner)
        .json(&json!({"profile_id":profile,"kind":"human"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let raw_grant = grant["token"].as_str().unwrap();
    assert_eq!(
        http.post(format!("{url}/beta/v1/grants"))
            .bearer_auth(raw_grant)
            .json(&json!({"profile_id":profile,"kind":"human"}))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        http.post(format!("{url}/beta/v1/grants"))
            .bearer_auth(&raw_owner)
            .json(&json!({"profile_id":profile,"kind":"writer"}))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        http.post(format!("{url}/beta/v1/capture"))
            .bearer_auth(&raw_owner)
            .json(&command(profile, "owner is not a profile writer"))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        http.delete(format!(
            "{url}/beta/v1/grants/{}",
            grant["grant_id"].as_str().unwrap()
        ))
        .bearer_auth(&raw_owner)
        .send()
        .await
        .unwrap()
        .status(),
        204
    );
    assert_eq!(
        http.get(format!("{url}/beta/v1/profiles/{profile}/events"))
            .bearer_auth(raw_grant)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        host.profiles(&host.owner_session().unwrap()).unwrap().len(),
        1
    );
    server.stop().await.unwrap();
}

#[test]
fn restart_preserves_authority_data_and_invalidates_old_runtime_sessions() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("beta");
    let host = BetaHost::open(&root).unwrap();
    let device = host.status().unwrap().device_id;
    let raw_owner = token(&root);
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic")
        .unwrap();
    let grant = local(&host, &owner, profile, GrantKind::Human);
    let stale = host.authenticate(&grant).unwrap();
    let input = command(profile, "persistent");
    let receipt = host.capture(&stale, &input).unwrap();
    assert!(BetaHost::open(&root).is_err());
    host.stop().unwrap();
    assert!(!host.status().unwrap().running);
    assert!(matches!(
        host.capture(&stale, &command(profile, "late")),
        Err(HostError::Stopped)
    ));
    let restarted = BetaHost::open(&root).unwrap();
    assert_eq!(restarted.status().unwrap().device_id, device);
    assert_eq!(token(&root), raw_owner);
    assert!(matches!(
        restarted.capture(&stale, &input),
        Err(HostError::Unauthorized)
    ));
    let session = restarted.authenticate(&grant).unwrap();
    assert_eq!(
        restarted.capture(&session, &input).unwrap().event_id,
        receipt.event_id
    );
    assert!(restarted.capture(&session, &input).unwrap().replayed);
    assert_eq!(
        restarted
            .profiles(&restarted.authenticate(&raw_owner).unwrap())
            .unwrap()
            .len(),
        1
    );
    restarted.stop().unwrap();
}

#[tokio::test]
async fn queued_work_loses_commit_eligibility_after_revoke_and_stop() {
    let (_directory, host, server, _url) = start().await;
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic")
        .unwrap();
    let grant = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: profile,
                kind: GrantKind::Human,
                agent_id: None,
            },
        )
        .unwrap();
    let session = host.authenticate(&grant.token).unwrap();
    let (release, wait) = tokio::sync::oneshot::channel();
    let queued_host = host.clone();
    let queued_session = session.clone();
    let late = tokio::spawn(async move {
        wait.await.unwrap();
        tokio::task::spawn_blocking(move || {
            queued_host.capture(&queued_session, &command(profile, "after revoke"))
        })
        .await
        .unwrap()
    });
    host.revoke_grant(&owner, grant.grant_id).unwrap();
    release.send(()).unwrap();
    assert!(matches!(late.await.unwrap(), Err(HostError::Unauthorized)));
    let session = host.native_human_session(&owner, profile).unwrap();
    let (release, wait) = tokio::sync::oneshot::channel();
    let queued_host = host.clone();
    let late = tokio::spawn(async move {
        wait.await.unwrap();
        tokio::task::spawn_blocking(move || {
            queued_host.capture(&session, &command(profile, "after stop"))
        })
        .await
        .unwrap()
    });
    server.stop().await.unwrap();
    release.send(()).unwrap();
    assert!(matches!(late.await.unwrap(), Err(HostError::Stopped)));
}

#[tokio::test]
async fn host_origin_and_explicit_frontend_cors_are_exact() {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("beta")).unwrap());
    let server = serve_with_frontend_origins(
        host.clone(),
        loopback(),
        vec!["http://localhost:1420".into()],
    )
    .await
    .unwrap();
    let url = format!("http://{}", server.addr());
    let http = client();
    assert_eq!(
        http.get(format!("{url}/beta/v1/hello"))
            .header("Host", "attacker.invalid")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        http.get(format!("{url}/beta/v1/hello"))
            .header("Origin", "http://attacker.invalid")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let preflight = http
        .request(reqwest::Method::OPTIONS, format!("{url}/beta/v1/capture"))
        .header("Origin", "http://localhost:1420")
        .header("Access-Control-Request-Method", "POST")
        .header(
            "Access-Control-Request-Headers",
            "authorization,content-type",
        )
        .send()
        .await
        .unwrap();
    assert_eq!(preflight.status(), 204);
    assert_eq!(
        preflight.headers()["access-control-allow-origin"],
        "http://localhost:1420"
    );
    assert_eq!(
        http.get(format!("{url}/beta/v1/hello"))
            .header("Origin", "http://localhost:14200")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        http.request(reqwest::Method::OPTIONS, format!("{url}/beta/v1/capture"))
            .header("Origin", "http://localhost:1420")
            .header("Access-Control-Request-Method", "POST")
            .header("Access-Control-Request-Headers", "x-untrusted")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let address = server.addr();
    server.stop().await.unwrap();
    assert!(tokio::net::TcpStream::connect(address).await.is_err());
}

#[tokio::test]
async fn rejects_nonlocal_origins_and_nonloopback_bind_without_creating_a_listener() {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("beta")).unwrap());
    for origin in [
        "*",
        "https://localhost:1420",
        "http://localhost:1420/",
        "http://user@localhost:1420",
        "http://localhost:1420?query",
        "http://localhost:1420#fragment",
        "http://192.0.2.1:1420",
        "http://localhost.evil:1420",
    ] {
        assert!(
            serve_with_frontend_origins(host.clone(), loopback(), vec![origin.into()])
                .await
                .is_err(),
            "{origin}"
        );
    }
    assert!(matches!(
        serve(host.clone(), "0.0.0.0:0".parse().unwrap()).await,
        Err(HostError::UntrustedBind)
    ));
    host.stop().unwrap();
}

#[tokio::test]
async fn default_origin_policy_has_no_implicit_frontend_allowlist_and_bounds_json() {
    let (_directory, host, server, url) = start().await;
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic")
        .unwrap();
    let human = local(&host, &owner, profile, GrantKind::Human);
    let http = client();
    assert_eq!(
        http.get(format!("{url}/beta/v1/hello"))
            .header("Origin", "http://localhost:1420")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let response = http
        .post(format!("{url}/beta/v1/capture"))
        .bearer_auth(&human)
        .header("Content-Type", "application/json")
        .body(json!({"text":"x".repeat(2*1024*1024)}).to_string())
        .send()
        .await
        .unwrap();
    assert!(response.status().is_client_error());
    let error: Value = response.json().await.unwrap();
    assert_eq!(error["error"]["code"], "invalid_request");
    server.stop().await.unwrap();
}

#[cfg(windows)]
#[test]
fn windows_connection_descriptor_has_a_protected_current_user_dacl() {
    use std::os::windows::process::CommandExt;
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("beta");
    let host = BetaHost::open(&root).unwrap();
    let script = r#"$ErrorActionPreference='Stop'; $acl=[System.IO.File]::GetAccessControl($env:EXOMIND_BETA_TEST_DESCRIPTOR); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if(-not $acl.AreAccessRulesProtected){exit 2}; $rules=@($acl.Access); if($rules.Count -ne 1){exit 3}; $actual=$rules[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($actual -ne $sid -or $rules[0].IsInherited -or $rules[0].AccessControlType -ne 'Allow'){exit 4}; 'private descriptor ACL verified'"#;
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env(
            "EXOMIND_BETA_TEST_DESCRIPTOR",
            root.join("connection.beta.json"),
        )
        .creation_flags(0x08000000)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "Windows descriptor ACL check failed"
    );
    let raw = token(&root);
    assert!(
        !std::fs::read(root.join("host-auth.sqlite3"))
            .unwrap()
            .windows(raw.len())
            .any(|part| part == raw.as_bytes())
    );
    host.stop().unwrap();
}

#[test]
fn existing_credentials_are_not_replaced_and_foreign_roots_are_untouched() {
    let directory = tempfile::tempdir().unwrap();
    let foreign = directory.path().join("foreign");
    std::fs::create_dir_all(&foreign).unwrap();
    std::fs::write(foreign.join("legacy.sqlite"), b"private sentinel").unwrap();
    assert!(matches!(
        BetaHost::open(&foreign),
        Err(HostError::ForeignRoot)
    ));
    assert_eq!(
        std::fs::read(foreign.join("legacy.sqlite")).unwrap(),
        b"private sentinel"
    );
    assert_eq!(std::fs::read_dir(&foreign).unwrap().count(), 1);
    let root = directory.path().join("beta");
    let host = BetaHost::open(&root).unwrap();
    host.stop().unwrap();
    std::fs::write(root.join("connection.beta.json"), b"broken descriptor").unwrap();
    assert!(matches!(
        BetaHost::open(&root),
        Err(HostError::CredentialsUnavailable)
    ));
    assert_eq!(
        std::fs::read(root.join("connection.beta.json")).unwrap(),
        b"broken descriptor"
    );
}

#[test]
fn facade_reads_report_failure_instead_of_empty_after_stop() {
    let directory = tempfile::tempdir().unwrap();
    let host = BetaHost::open(&directory.path().join("beta")).unwrap();
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic")
        .unwrap();
    let session = host.native_human_session(&owner, profile).unwrap();
    host.stop().unwrap();
    assert!(matches!(
        host.events_page(&session, profile, &EventQuery::default()),
        Err(HostError::Stopped)
    ));
}

#[tokio::test]
async fn real_cli_crash_releases_the_root_and_recovers_committed_identity_and_receipt() {
    struct OwnedChild(std::process::Child);
    impl Drop for OwnedChild {
        fn drop(&mut self) {
            // An owned unreaped Child cannot be replaced by an unrelated PID;
            // Windows retains its native process handle. No image-name cleanup.
            if self.0.try_wait().ok().flatten().is_none() {
                let _ = self.0.kill();
            }
            let _ = self.0.wait();
        }
    }
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("cli-crash");
    let mut process = std::process::Command::new(env!("CARGO_BIN_EXE_exomind-beta"));
    process
        .args(["--data-dir", root.to_str().unwrap(), "--port", "0"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x08000000);
    }
    let mut child = OwnedChild(process.spawn().unwrap());
    let http = client();
    let started = std::time::Instant::now();
    let (base_url, raw_owner, before) = loop {
        assert!(
            child.0.try_wait().unwrap().is_none(),
            "owned CLI exited before readiness"
        );
        assert!(
            started.elapsed() < std::time::Duration::from_secs(20),
            "owned CLI readiness timed out"
        );
        if let Ok(bytes) = std::fs::read(root.join("connection.beta.json")) {
            if let Ok(descriptor) = serde_json::from_slice::<Value>(&bytes) {
                if let (Some(url), Some(raw)) = (
                    descriptor["url"].as_str(),
                    descriptor["owner_token"].as_str(),
                ) {
                    assert!(url.starts_with("http://127.0.0.1:"));
                    if let Ok(response) = http
                        .get(format!("{url}/beta/v1/hello"))
                        .timeout(std::time::Duration::from_millis(300))
                        .send()
                        .await
                    {
                        if response.status().is_success() {
                            let hello: Value = response.json().await.unwrap();
                            if hello["running"] == true {
                                break (url.to_owned(), raw.to_owned(), hello);
                            }
                        }
                    }
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    };
    assert!(matches!(BetaHost::open(&root), Err(HostError::RootInUse)));
    let profile = ProfileId::new();
    let response = http
        .put(format!("{base_url}/beta/v1/profiles/{profile}"))
        .bearer_auth(&raw_owner)
        .json(&json!({"name":"synthetic CLI crash"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let grant: Value = http
        .post(format!("{base_url}/beta/v1/grants"))
        .bearer_auth(&raw_owner)
        .json(&json!({"profile_id":profile,"kind":"human"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let raw_grant = grant["token"].as_str().unwrap().to_owned();
    let input = command(profile, "committed before owned process termination");
    let response = http
        .post(format!("{base_url}/beta/v1/capture"))
        .bearer_auth(&raw_grant)
        .json(&input)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let original: exomind_core::Receipt = response.json().await.unwrap();
    // Force process termination: do not call Host.stop, graceful HTTP shutdown,
    // or a destructor in that process and then label it crash recovery.
    child.0.kill().unwrap();
    child.0.wait().unwrap();
    let recovered = BetaHost::open(&root).unwrap();
    assert_eq!(
        recovered.status().unwrap().device_id.to_string(),
        before["device_id"].as_str().unwrap()
    );
    assert_ne!(
        recovered.status().unwrap().runtime_id.to_string(),
        before["runtime_id"].as_str().unwrap()
    );
    assert_eq!(token(&root), raw_owner);
    let owner = recovered.authenticate(&raw_owner).unwrap();
    assert_eq!(recovered.profiles(&owner).unwrap().len(), 1);
    let session = recovered.authenticate(&raw_grant).unwrap();
    assert_eq!(
        recovered
            .receipt(&session, profile, input.command_id)
            .unwrap()
            .unwrap(),
        original
    );
    let events = recovered
        .events_page(&session, profile, &EventQuery::default())
        .unwrap();
    assert_eq!(events.items.len(), 1);
    assert_eq!(events.items[0].text, input.text);
    let replay = recovered.capture(&session, &input).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.event_digest, original.event_digest);
    recovered.stop().unwrap();
}
