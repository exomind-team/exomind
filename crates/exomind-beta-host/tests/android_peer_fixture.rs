#![cfg(target_os = "windows")]
//! Opt-in real counterpart for the APK acceptance driver. This exercises a
//! Windows Controller fixture, never the Windows GUI. No HTTP bypass, raw DB
//! writes, forged receipts, imported third-device origins or TLS exceptions.
//!
//! Compile before starting an AVD:
//! cargo test -p exomind-beta-host --test android_peer_fixture --no-run
//! The Node driver supplies private G: root + matching nonce, then invokes the
//! resulting test executable with --ignored --exact and this test's name.
//!
//! File protocol (all under the driver's current-user-only ACL, never stdout):
//! - scope-marker.json: {protocol,scope,nonce}; Host data stays in host/.
//! - channel/ready.json and invitation.json: genuine signed invitation + public
//!   manifest. Node pastes the invitation verbatim into the APK's real UI.
//! - command-NNNNNN.json: {protocol,nonce,seq,operation:{kind,...}}; one in
//!   flight; response-NNNNNN.json: {protocol,seq,ok,value|error}.
//! - Operations: observe, route_android(device_id,forward_port), append_windows
//!   (label), source_offline, source_online. No peer "sync now" operation.
//! - stop.json with matching nonce requests owned cleanup; terminal.json is
//!   authoritative cleanup confirmation. 512 commands / 520s session maximum.
use exomind_beta_host::{
    BetaHost, CreatePeerInvitation, HostError, PeerCapabilities, PeerJoinState, PeerNetwork,
    PeerNetworkSettings, Session,
};
use exomind_core::{
    BeginStageCommand, CaptureCommand, CommandId, DeviceId, EventId, EventQuery, FeedbackInput,
    MAX_ORIGINAL_CHUNK_BYTES, OriginalId, OriginalRef, ProfileId, StageId, StageState,
    TimeblockAction, TimeblockCommand, TimeblockId, TimerSpec,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
type Result<T> = std::result::Result<T, String>;
const PROTOCOL: &str = "exomind-windows-controller-android-fixture/1";
const SCOPE: &str = "Windows controller fixture ↔ Android APK Native UI; Windows GUI not exercised; own-origin only, no third-device relay";
fn host<T>(result: std::result::Result<T, HostError>) -> Result<T> {
    result.map_err(|error| error.to_string())
}
fn write(path: &Path, value: &Value) -> Result<()> {
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
fn capture(
    h: &BetaHost,
    human: &Session,
    p: ProfileId,
    text: &str,
    originals: Vec<OriginalRef>,
) -> Result<EventId> {
    let command = CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        occurred_at_ms: now(),
        text: text.into(),
        tags: vec![],
        originals,
    };
    let receipt = host(h.capture(human, &command))?;
    if receipt.event_id != command.event_id {
        return Err("capture receipt identity mismatch".into());
    }
    Ok(command.event_id)
}
fn action(h: &BetaHost, human: &Session, p: ProfileId, action: TimeblockAction) -> Result<EventId> {
    let command = TimeblockCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        expected_revision: host(h.timeblock_snapshot(human, p))?.revision,
        action,
    };
    let receipt = host(h.apply_timeblock(human, &command))?;
    Ok(receipt.event_id)
}
fn typed_round(h: &BetaHost, human: &Session, p: ProfileId, label: &str) -> Result<Vec<EventId>> {
    let block = TimeblockId::new();
    Ok(vec![
        action(
            h,
            human,
            p,
            TimeblockAction::Start {
                block_id: block,
                name: label.into(),
                note: String::new(),
                timer: TimerSpec::CountUp,
            },
        )?,
        action(h, human, p, TimeblockAction::EndAction { block_id: block })?,
        action(
            h,
            human,
            p,
            TimeblockAction::SubmitFeedback {
                block_id: block,
                feedback: FeedbackInput::Skipped,
            },
        )?,
    ])
}
fn original(h: &BetaHost, human: &Session, p: ProfileId) -> Result<OriginalRef> {
    let bytes: Vec<u8> = (0..1024 * 1024 + 713)
        .map(|i| ((i as u64 * 137 + i as u64 / 257) % 256) as u8)
        .collect();
    let stage = StageId::new();
    host(h.begin_stage(
        human,
        &BeginStageCommand {
            stage_id: stage,
            original_id: OriginalId::new(),
            profile_id: p,
            expected_sha256: format!("{:x}", Sha256::digest(&bytes)),
            byte_length: bytes.len() as u64,
            file_name: "controller-to-android.00ff.unknown137".into(),
            media_type: "application/x-unknown".into(),
        },
    ))?;
    for (i, chunk) in bytes.chunks(MAX_ORIGINAL_CHUNK_BYTES).enumerate() {
        host(h.write_stage_chunk(
            human,
            p,
            stage,
            (i * MAX_ORIGINAL_CHUNK_BYTES) as u64,
            chunk,
        ))?;
    }
    let verified = host(h.verify_stage(human, p, stage))?;
    if verified.state != StageState::Verified {
        return Err("source original is not verified".into());
    }
    Ok(verified.original)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    protocol: String,
    nonce: Uuid,
    seq: u64,
    operation: Operation,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
enum Operation {
    Observe,
    RouteAndroid {
        device_id: DeviceId,
        forward_port: u16,
    },
    AppendWindows {
        label: String,
    },
    SourceOffline,
    SourceOnline,
}
struct Rig {
    host: Arc<BetaHost>,
    owner: Session,
    human: Session,
    network: Arc<PeerNetwork>,
    p: ProfileId,
    q: ProfileId,
    listener_port: u16,
    original: OriginalRef,
}
impl Rig {
    fn snapshot(&self) -> Result<Value> {
        Ok(
            json!({"scope":SCOPE,"status":host(self.host.status())?,"profiles":host(self.host.profiles(&self.owner))?,"network":host(self.network.status(self.p))?,"events":host(self.host.events_page(&self.human,self.p,&EventQuery::default()))?,"nodes":host(self.host.timeblock_nodes(&self.human,self.p,&EventQuery::default()))?,"own_origin":host(self.host.local_origin_state(&self.owner,self.p))?,"source_original":self.network.original_status(self.p,self.original.original_id).map_err(|e|e.to_string())?,"q":self.q}),
        )
    }
    async fn perform(&self, operation: Operation) -> Result<Value> {
        match operation {
            Operation::Observe => self.snapshot(),
            Operation::RouteAndroid {
                device_id,
                forward_port,
            } => {
                if forward_port == 0 || device_id == host(self.host.status())?.device_id {
                    return Err("invalid owned Android route hint".into());
                }
                let members = host(self.host.peer_members(&self.owner, self.p))?;
                let member = members
                    .into_iter()
                    .find(|m| {
                        m.device_id == device_id && !m.revoked && m.state == PeerJoinState::Ready
                    })
                    .ok_or("Android device has no actual Ready membership")?;
                host(self.host.save_peer_routes(
                    &self.owner,
                    self.p,
                    device_id,
                    vec![SocketAddr::new(
                        IpAddr::V4(Ipv4Addr::LOCALHOST),
                        forward_port,
                    )],
                ))?;
                Ok(
                    json!({"device_id":device_id,"member_generation":member.generation,"pin":member.pin,"loopback_forward_port":forward_port,"status":self.snapshot()?}),
                )
            }
            Operation::AppendWindows { label } => {
                if label.len() > 180 || label.is_empty() {
                    return Err("invalid synthetic label".into());
                }
                let event = capture(&self.host, &self.human, self.p, &label, vec![])?;
                let nodes =
                    typed_round(&self.host, &self.human, self.p, &format!("{label} typed"))?;
                Ok(json!({"event_id":event,"typed_event_ids":nodes,"snapshot":self.snapshot()?}))
            }
            Operation::SourceOffline => {
                host(self.network.set_enabled(false).await)?;
                Ok(json!({"online":false,"listen_addresses":host(self.network.local_addresses())?}))
            }
            Operation::SourceOnline => {
                host(self.network.set_enabled(true).await)?;
                let addresses = host(self.network.local_addresses())?;
                if addresses.is_empty()
                    || addresses
                        .iter()
                        .any(|address| address.port() != self.listener_port)
                {
                    return Err(
                        "source listener port changed; no silent Android route mutation is allowed"
                            .into(),
                    );
                }
                Ok(json!({"online":true,"listen_addresses":addresses}))
            }
        }
    }
}
async fn commands(rig: &Rig, channel: &Path, nonce: Uuid) -> Result<()> {
    let limit = Instant::now() + Duration::from_secs(520);
    let mut next = 1;
    loop {
        if Instant::now() >= limit {
            return Err("finite fixture session deadline".into());
        }
        let stop = channel.join("stop.json");
        if stop.exists() {
            let value: Value = serde_json::from_slice(&fs::read(stop).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            if value["nonce"] == nonce.to_string() {
                return Ok(());
            }
            return Err("stop nonce mismatch".into());
        }
        let input = channel.join(format!("command-{next:06}.json"));
        if !input.exists() {
            tokio::time::sleep(Duration::from_millis(100)).await;
            continue;
        }
        let bytes = fs::read(input).map_err(|e| e.to_string())?;
        if bytes.len() > 16 * 1024 {
            return Err("fixture command too large".into());
        }
        let envelope: Envelope = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if envelope.protocol != PROTOCOL || envelope.nonce != nonce || envelope.seq != next {
            return Err("fixture protocol/nonce/sequence mismatch".into());
        }
        let result = rig.perform(envelope.operation).await;
        write(
            &channel.join(format!("response-{next:06}.json")),
            &match result {
                Ok(value) => json!({"protocol":PROTOCOL,"seq":next,"ok":true,"value":value}),
                Err(error) => json!({"protocol":PROTOCOL,"seq":next,"ok":false,"error":error}),
            },
        )?;
        next += 1;
        if next > 512 {
            return Err("fixture command budget exhausted".into());
        }
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "Requires the owned Android APK driver and explicit private G: fixture root; never a Windows GUI acceptance"]
async fn windows_controller_android_native_peer_fixture() {
    let root = PathBuf::from(
        std::env::var("EXOMIND_ANDROID_PEER_FIXTURE_ROOT")
            .expect("explicit private fixture root required"),
    );
    let nonce: Uuid = std::env::var("EXOMIND_ANDROID_PEER_FIXTURE_NONCE")
        .expect("fixture nonce required")
        .parse()
        .expect("fixture nonce UUID");
    assert!(
        root.is_absolute() && root.starts_with(Path::new("G:/exomind-peer-fixture-private")),
        "fixture must stay in the dedicated synthetic G root"
    );
    assert!(
        !fs::symlink_metadata(&root)
            .unwrap()
            .file_type()
            .is_symlink(),
        "fixture root must not be a symlink/junction"
    );
    let canonical = root.canonicalize().unwrap();
    let canonical = canonical.to_string_lossy();
    let clean = PathBuf::from(canonical.strip_prefix(r"\\?\").unwrap_or(&canonical));
    assert_eq!(
        clean.parent(),
        Some(Path::new("G:/exomind-peer-fixture-private")),
        "resolved fixture root escaped its exact dedicated parent"
    );
    let marker: Value = serde_json::from_slice(
        &fs::read(root.join("scope-marker.json"))
            .expect("driver private directory marker required"),
    )
    .expect("marker JSON");
    assert_eq!(marker["protocol"], PROTOCOL);
    assert_eq!(marker["nonce"], nonce.to_string());
    assert_eq!(marker["scope"], SCOPE);
    let channel = root.join("channel");
    fs::create_dir_all(&channel).unwrap();
    let host = Arc::new(BetaHost::open(&root.join("host")).unwrap());
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    let q = ProfileId::new();
    host.provision_profile(&owner, p, "Shared P · controller fixture")
        .unwrap();
    host.provision_profile(&owner, q, "Windows private Q · not shared")
        .unwrap();
    let human = host.native_human_session(&owner, p).unwrap();
    let q_human = host.native_human_session(&owner, q).unwrap();
    let q_event = capture(
        &host,
        &q_human,
        q,
        "private fixture Q remains outside P",
        vec![],
    )
    .unwrap();
    let initial = capture(
        &host,
        &human,
        p,
        "Windows controller initial own-origin capture",
        vec![],
    )
    .unwrap();
    let typed = typed_round(&host, &human, p, "Windows controller typed completed block").unwrap();
    let original = original(&host, &human, p).unwrap();
    let original_event = capture(
        &host,
        &human,
        p,
        "Windows controller published referenced original",
        vec![original.clone()],
    )
    .unwrap();
    host.start_services().unwrap();
    host.save_peer_network_settings(
        &owner,
        PeerNetworkSettings {
            enabled: false,
            preferred_port: 0,
        },
    )
    .unwrap();
    let network = PeerNetwork::new(host.clone(), owner.clone()).unwrap();
    network.set_enabled(true).await.unwrap();
    let port = network.local_addresses().unwrap().first().unwrap().port();
    // The endpoint hint is signed by this real Owner; the signature is never
    // patched by Node. 10.0.2.2 is Android Emulator's host-loopback adapter.
    let invitation = host
        .create_peer_invitation(
            &owner,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: p,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![SocketAddr::new(
                    IpAddr::V4(Ipv4Addr::new(10, 0, 2, 2)),
                    port,
                )],
                ttl_seconds: 600,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    write(
        &channel.join("invitation.json"),
        &serde_json::to_value(invitation).unwrap(),
    )
    .unwrap();
    write(&channel.join("ready.json"),&json!({"protocol":PROTOCOL,"scope":SCOPE,"windows_device_id":host.status().unwrap().device_id,"windows_fingerprint":host.device_identity(&owner).unwrap().fingerprint_sha256,"profile_id":p,"private_q_id":q,"q_event_id":q_event,"initial_capture_event_id":initial,"typed_event_ids":typed,"original_event_id":original_event,"original":original,"listener_port":port,"invitation_file":"invitation.json","invitation_transport":"Owner-signed emulator host hint 10.0.2.2; unchanged TLS pin/protocol","expires_after_seconds":520})).unwrap();
    let rig = Rig {
        host: host.clone(),
        owner,
        human,
        network: network.clone(),
        p,
        q,
        listener_port: port,
        original,
    };
    let work = tokio::time::timeout(Duration::from_secs(540), commands(&rig, &channel, nonce))
        .await
        .map_err(|_| "finite outer fixture timeout".to_string())
        .and_then(|value| value);
    let network_stopped = network.stop().await.map_err(|e| e.to_string());
    let stopping = host.clone();
    let host_stopped = tokio::time::timeout(
        Duration::from_secs(15),
        tokio::task::spawn_blocking(move || stopping.stop()),
    )
    .await
    .map_err(|_| "Host stop unconfirmed".to_string())
    .and_then(|value| value.map_err(|_| "Host stop task failed".to_string()))
    .and_then(|value| value.map_err(|e| e.to_string()));
    write(&channel.join("terminal.json"),&json!({"scope":SCOPE,"ok":work.is_ok()&&network_stopped.is_ok()&&host_stopped.is_ok(),"work":work.as_ref().err(),"network_stop":network_stopped.as_ref().err(),"host_stop":host_stopped.as_ref().err()})).unwrap();
    assert!(
        work.is_ok() && network_stopped.is_ok() && host_stopped.is_ok(),
        "fixture or owned cleanup failed; inspect private terminal.json"
    );
}
