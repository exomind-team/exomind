//! Opt-in broker for a genuinely external, low-grant Agent. Run only after
//! compiling this test and providing EXOMIND_BETA_EXTERNAL_AGENT_QA_DIR as a
//! new absolute path whose parent already exists. No default or legacy root.
//!
//! All child-Agent filesystem access must be restricted to agent/. The broker
//! expected facts and both Host roots stay outside that directory. This is a
//! file handoff boundary, not an OS sandbox against the same user.
//! Owner credentials never enter agent-connection.json or stdout.
//!
//! File handshake, atomic publication required, all with matching protocol and
//! run_id: agent-connection.json -> ready-to-revoke.json -> revoked.json ->
//! final-result.json. Connection.workflow describes exact export/result fields.
//! The Agent exports the original 250 human captures before its one fixed
//! agent_note append, or an independent typed external summary in producer
//! mode, retaining its command/event IDs for receipt/replay.
//! Markdown+manifest are CLIENT exports, not a server bundle/wait API.
//! The broker independently compares actual facts, files and HTTP boundaries.
//! Whole action 260s, including setup; cleanup reserve 40s; HTTP timeout 3s.
use exomind_beta_host::{
    BetaHost, GrantKind, GrantRequest, HostError, RunningServer, Session, serve,
};
use exomind_core::{
    AgentId, AuthorKind, BeginStageCommand, CaptureCommand, CommandId, DeviceId, EventId,
    EventQuery, EventRecord, ExternalSummaryAppendCommand, ExternalSummaryRecord,
    MAX_ORIGINAL_CHUNK_BYTES, OriginalId, OriginalRef, ProfileId, Receipt, StageId, StageState,
    SummaryInputRecord, SummaryRemoteVisibility, TimelineItem,
};
use rand::{RngCore, rngs::OsRng};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::time::{Instant, sleep, timeout_at};
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
const PROTOCOL: &str = "exomind-external-agent-fixture/1";
const EXPORT_PROTOCOL: &str = "exomind-beta-client-export/1";
const ENV_ROOT: &str = "EXOMIND_BETA_EXTERNAL_AGENT_QA_DIR";
const ENV_PRODUCER_ROOT: &str = "EXOMIND_BETA_EXTERNAL_PRODUCER_QA_DIR";
const SOURCE_COUNT: usize = 250;
const ORIGINAL_LENGTH: usize = 262_281;
const JSON_LIMIT: usize = 2 * 1024 * 1024;
const MARKDOWN_LIMIT: usize = 1024 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
enum FixtureMode {
    AgentNote,
    SummaryProducer,
}
impl FixtureMode {
    fn kind(self) -> GrantKind {
        match self {
            Self::AgentNote => GrantKind::AgentNote,
            Self::SummaryProducer => GrantKind::SummaryProducer,
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::AgentNote => "agent_note",
            Self::SummaryProducer => "summary_producer",
        }
    }
    fn env_key(self) -> &'static str {
        match self {
            Self::AgentNote => ENV_ROOT,
            Self::SummaryProducer => ENV_PRODUCER_ROOT,
        }
    }
    fn append_capability(self) -> &'static str {
        match self {
            Self::AgentNote => "capture_append_agent_note",
            Self::SummaryProducer => "external_summary_append",
        }
    }
}

fn require(condition: bool, message: &str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}
fn host<T>(result: std::result::Result<T, HostError>) -> Result<T> {
    result.map_err(|_| "formal Host facade operation failed".into())
}
fn ordinary(path: &Path, directory: bool) -> Result<()> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "artifact metadata unavailable")?;
    require(
        !metadata.file_type().is_symlink(),
        "symlink artifact refused",
    )?;
    require(
        if directory {
            metadata.is_dir()
        } else {
            metadata.is_file()
        },
        "artifact type refused",
    )?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        require(
            metadata.file_attributes() & 0x400 == 0,
            "reparse artifact refused",
        )?;
    }
    Ok(())
}
async fn fresh_private_root(env_key: &str) -> Result<PathBuf> {
    let root = PathBuf::from(
        std::env::var_os(env_key).ok_or("explicit fresh private QA directory is required")?,
    );
    require(root.is_absolute(), "QA path must be absolute")?;
    require(
        !root
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir)),
        "ambiguous QA path refused",
    )?;
    require(
        fs::symlink_metadata(&root)
            .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound),
        "QA directory must not already exist",
    )?;
    let parent = root
        .parent()
        .ok_or("QA directory requires an existing parent")?;
    for ancestor in parent.ancestors() {
        ordinary(ancestor, true)?;
    }
    fs::create_dir(&root).map_err(|_| "cannot create fresh QA directory")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
            .map_err(|_| "cannot protect QA directory")?;
        require(
            fs::metadata(&root)
                .map_err(|_| "QA mode unavailable")?
                .permissions()
                .mode()
                & 0o777
                == 0o700,
            "QA directory is not private",
        )?;
    }
    #[cfg(windows)]
    {
        use std::{
            os::windows::process::CommandExt,
            process::{Command, Stdio},
        };
        // Same current-user DACL model as Host storage, with a bounded owned
        // child and readback. No path interpolation into shell source.
        let script = r#"
$ErrorActionPreference = 'Stop'
$p = $env:EXOMIND_EXTERNAL_QA_ACL_PATH
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [IO.Directory]::GetAccessControl($p)
$acl.SetAccessRuleProtection($true, $false)
foreach ($r in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($r) }
$rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
[void]$acl.AddAccessRule($rule)
[IO.Directory]::SetAccessControl($p, $acl)
$actual = [IO.Directory]::GetAccessControl($p)
if (!$actual.AreAccessRulesProtected) { exit 11 }
$rules = @($actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or $rules[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { exit 12 }
"#;
        let mut child = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("EXOMIND_EXTERNAL_QA_ACL_PATH", &root)
            .creation_flags(0x08000000)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "cannot start private ACL check")?;
        let until = Instant::now() + Duration::from_secs(8);
        loop {
            if let Some(status) = child
                .try_wait()
                .map_err(|_| "ACL child status unavailable")?
            {
                require(status.success(), "private ACL application/readback failed")?;
                break;
            }
            if Instant::now() >= until {
                let _ = child.kill();
                let shutdown = Instant::now() + Duration::from_secs(1);
                while Instant::now() < shutdown {
                    if child.try_wait().ok().flatten().is_some() {
                        return Err("private ACL check timed out; owned child exited".into());
                    }
                    sleep(Duration::from_millis(25)).await;
                }
                return Err("private ACL check and owned child shutdown unconfirmed".into());
            }
            sleep(Duration::from_millis(25)).await;
        }
    }
    #[cfg(not(any(unix, windows)))]
    return Err("private QA permissions unsupported on this platform".into());
    ordinary(&root, true)?;
    Ok(root)
}
fn write_new_json(path: &Path, value: &Value) -> Result<()> {
    require(!path.exists(), "broker refuses to overwrite an artifact")?;
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| "cannot create broker artifact")?;
    file.write_all(&serde_json::to_vec_pretty(value).map_err(|_| "broker JSON encoding failed")?)
        .map_err(|_| "broker artifact write failed")?;
    file.sync_all().map_err(|_| "broker artifact sync failed")?;
    drop(file);
    // A hard link publishes a fully written file without Unix rename's
    // overwrite race. Both names are inside this fresh owned directory.
    fs::hard_link(&temporary, path).map_err(|_| "broker artifact publication failed")?;
    fs::remove_file(&temporary).map_err(|_| "broker temporary artifact cleanup failed".to_owned())
}
fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>> {
    ordinary(path, false)?;
    let file = File::open(path).map_err(|_| "Agent artifact cannot be opened")?;
    require(
        file.metadata()
            .map_err(|_| "Agent artifact size unavailable")?
            .len()
            <= limit as u64,
        "Agent artifact exceeds limit",
    )?;
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Agent artifact read failed")?;
    require(bytes.len() <= limit, "Agent artifact grew beyond limit")?;
    Ok(bytes)
}
fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T> {
    serde_json::from_slice(&read_bounded(path, JSON_LIMIT)?)
        .map_err(|_| "Agent JSON artifact is invalid".to_owned())
}
async fn wait_file(path: &Path, agent: &Path, deadline: Instant) -> Result<()> {
    loop {
        match fs::symlink_metadata(path) {
            Ok(_) => {
                ordinary(path, false)?;
                return Ok(());
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("handshake metadata failed".into()),
        }
        let final_file = agent.join("final-result.json");
        if path != final_file && final_file.exists() {
            let final_value: Value = read_json(&final_file)?;
            require(
                final_value.get("ok").and_then(Value::as_bool) != Some(false),
                "external Agent reported failure before ready",
            )?;
        }
        if Instant::now() >= deadline {
            return Err("external Agent file handshake timed out".into());
        }
        sleep(Duration::from_millis(150)).await;
    }
}
fn facts(
    host_instance: &BetaHost,
    session: &Session,
    profile: ProfileId,
) -> Result<Vec<EventRecord>> {
    let mut all = Vec::new();
    let mut before = None;
    let mut through = None;
    for _ in 0..8 {
        let page = host(host_instance.events_page(
            session,
            profile,
            &EventQuery {
                before,
                through,
                limit: 100,
                search: None,
            },
        ))?;
        if through.is_none() {
            through = Some(page.highwater);
        }
        all.extend(page.items);
        before = page.next_before;
        if before.is_none() {
            return Ok(all);
        }
    }
    Err("broker fact read unexpectedly exceeded eight pages".into())
}
fn fact_map(records: &[EventRecord]) -> Result<BTreeMap<String, Value>> {
    let mut map = BTreeMap::new();
    for record in records {
        require(
            map.insert(
                record.event_id.to_string(),
                serde_json::to_value(record).map_err(|_| "fact encoding failed")?,
            )
            .is_none(),
            "duplicate event ID in fact set",
        )?;
    }
    Ok(map)
}
async fn response_status(request: reqwest::RequestBuilder, expected: u16) -> Result<()> {
    let response = request
        .send()
        .await
        .map_err(|_| "bounded HTTP boundary request failed")?;
    require(
        response.status().as_u16() == expected,
        "actual HTTP boundary status mismatch",
    )
}
fn source_bytes() -> Vec<u8> {
    let mut bytes = vec![0; ORIGINAL_LENGTH];
    OsRng.fill_bytes(&mut bytes);
    bytes
}
fn create_original(
    instance: &BetaHost,
    human: &Session,
    profile: ProfileId,
    bytes: &[u8],
) -> Result<OriginalRef> {
    let stage = StageId::new();
    host(instance.begin_stage(
        human,
        &BeginStageCommand {
            stage_id: stage,
            profile_id: profile,
            original_id: OriginalId::new(),
            expected_sha256: format!("{:x}", Sha256::digest(bytes)),
            byte_length: bytes.len() as u64,
            file_name: "synthetic-external-agent.bin".into(),
            media_type: "application/octet-stream".into(),
        },
    ))?;
    for (index, chunk) in bytes.chunks(MAX_ORIGINAL_CHUNK_BYTES).enumerate() {
        host(instance.write_stage_chunk(
            human,
            profile,
            stage,
            (index * MAX_ORIGINAL_CHUNK_BYTES) as u64,
            chunk,
        ))?;
    }
    let verified = host(instance.verify_stage(human, profile, stage))?;
    require(
        verified.state == StageState::Verified,
        "seed original was not verified",
    )?;
    Ok(verified.original)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BeforeChecks {
    observer_write: u16,
    wrong_profile: u16,
    wrong_instance: u16,
    unknown_capability: u16,
    wait_capability: u16,
    export_bundle_capability: u16,
    external_summary_capability: u16,
    forged_author: u16,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Ready {
    protocol: String,
    run_id: Uuid,
    phase: String,
    append_command: CaptureCommand,
    append_receipt: Receipt,
    observed_statuses: BeforeChecks,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceSnapshot {
    highwater: u64,
    complete: bool,
    pages_read: usize,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ExportOriginal {
    original_id: OriginalId,
    byte_length: u64,
    sha256: String,
    relative_path: String,
    state: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    protocol: String,
    run_id: Uuid,
    profile_id: ProfileId,
    device_id: DeviceId,
    runtime_id: Uuid,
    client_side_export: bool,
    server_wait_api: bool,
    server_export_bundle_api: bool,
    external_summary_append: bool,
    source_snapshot: SourceSnapshot,
    records: Vec<EventRecord>,
    original: ExportOriginal,
    markdown_relative_path: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FinalResult {
    protocol: String,
    run_id: Uuid,
    phase: String,
    ok: bool,
    revoked_read_status: u16,
    revoked_append_status: u16,
    observer_read_status: u16,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProducerChecks {
    producer_capture: u16,
    producer_stage: u16,
    producer_timer: u16,
    producer_model_request: u16,
    producer_model_control: u16,
    observer_append: u16,
    wrong_profile: u16,
    wrong_instance: u16,
    unknown_capability: u16,
    forged_author: u16,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProducerReady {
    protocol: String,
    run_id: Uuid,
    phase: String,
    append_command: ExternalSummaryAppendCommand,
    append_receipt: Receipt,
    replay_receipt: Receipt,
    observed_statuses: ProducerChecks,
}
fn same_receipt(left: &Receipt, right: &Receipt) -> bool {
    left.command_id == right.command_id
        && left.event_id == right.event_id
        && left.profile_id == right.profile_id
        && left.local_seq == right.local_seq
        && left.event_digest == right.event_digest
        && left.durability == right.durability
}

struct Broker {
    mode: FixtureMode,
    instance: Arc<BetaHost>,
    second: Arc<BetaHost>,
    owner: Session,
    human: Session,
    profile: ProfileId,
    other_profile: ProfileId,
    other_human: Session,
    agent_id: AgentId,
    agent_grant_id: Uuid,
    agent_token: String,
    observer_token: String,
    note_negative_token: Option<String>,
    base: String,
    other_base: String,
    run_id: Uuid,
    original: OriginalRef,
    expected_bytes: Vec<u8>,
    expected: Vec<EventRecord>,
    expected_other: Vec<EventRecord>,
    append_text: String,
}
impl Broker {
    async fn setup(
        root: &Path,
        servers: &mut Vec<RunningServer>,
        mode: FixtureMode,
    ) -> Result<Self> {
        let private = root.join("broker");
        fs::create_dir(&private).map_err(|_| "cannot create broker directory")?;
        let instance = Arc::new(host(BetaHost::open(&private.join("host-a")))?);
        let owner = host(instance.owner_session())?;
        let profile = ProfileId::new();
        let other_profile = ProfileId::new();
        host(instance.provision_profile(&owner, profile, "Synthetic external Agent P"))?;
        host(instance.provision_profile(&owner, other_profile, "Synthetic external Agent Q"))?;
        let human = host(instance.native_human_session(&owner, profile))?;
        let other_human = host(instance.native_human_session(&owner, other_profile))?;
        let bytes = source_bytes();
        let original = create_original(&instance, &human, profile, &bytes)?;
        let run_id = Uuid::new_v4();
        for index in 0..SOURCE_COUNT {
            host(instance.capture(
                &human,
                &CaptureCommand {
                    command_id: CommandId::new(),
                    event_id: EventId::new(),
                    profile_id: profile,
                    occurred_at_ms: 1_700_000_000_000 + (index % 3) as i64,
                    text: format!("Synthetic source {index:03} for run {run_id}"),
                    tags: vec![
                        "synthetic".into(),
                        "source".into(),
                        format!("bucket:{}", index % 7),
                    ],
                    originals: if index == 0 {
                        vec![original.clone()]
                    } else {
                        vec![]
                    },
                },
            ))?;
        }
        host(instance.capture(
            &other_human,
            &CaptureCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: other_profile,
                occurred_at_ms: 1_700_000_000_000,
                text: format!("Private synthetic Q sentinel for run {run_id}"),
                tags: vec!["synthetic-q".into()],
                originals: vec![],
            },
        ))?;
        let expected = facts(&instance, &human, profile)?;
        let expected_other = facts(&instance, &other_human, other_profile)?;
        require(
            expected.len() == SOURCE_COUNT && expected_other.len() == 1,
            "seed fact count mismatch",
        )?;
        let agent_id = AgentId::new();
        let agent = host(instance.grant(
            &owner,
            GrantRequest {
                profile_id: profile,
                kind: mode.kind(),
                agent_id: Some(agent_id),
            },
        ))?;
        let observer = host(instance.grant(
            &owner,
            GrantRequest {
                profile_id: profile,
                kind: GrantKind::Observer,
                agent_id: None,
            },
        ))?;
        let note_negative_token = if mode == FixtureMode::SummaryProducer {
            Some(
                host(instance.grant(
                    &owner,
                    GrantRequest {
                        profile_id: profile,
                        kind: GrantKind::AgentNote,
                        agent_id: Some(AgentId::new()),
                    },
                ))?
                .token,
            )
        } else {
            None
        };
        let first = serve(
            instance.clone(),
            "127.0.0.1:0"
                .parse()
                .map_err(|_| "loopback address invalid")?,
        )
        .await
        .map_err(|_| "first formal HTTP listener failed")?;
        let base = format!("http://{}", first.addr());
        servers.push(first);
        let second = Arc::new(host(BetaHost::open(&private.join("host-b")))?);
        let second_server = serve(
            second.clone(),
            "127.0.0.1:0"
                .parse()
                .map_err(|_| "loopback address invalid")?,
        )
        .await
        .map_err(|_| "second formal HTTP listener failed")?;
        let other_base = format!("http://{}", second_server.addr());
        servers.push(second_server);
        let append_text = match mode {
            FixtureMode::AgentNote => format!(
                "Synthetic external Agent classification for run {run_id}: original sources remain immutable."
            ),
            FixtureMode::SummaryProducer => format!(
                "Synthetic external Agent summary for run {run_id}: 250 source captures are retained; original body understanding is not attested."
            ),
        };
        write_new_json(
            &private.join("broker-private-expected.json"),
            &json!({ "protocol": PROTOCOL, "run_id": run_id, "mode":mode.label(), "profile_id": profile, "other_profile_id": other_profile, "source_facts": expected, "other_facts": expected_other, "original": original, "agent_id": agent_id, "append_text": append_text }),
        )?;
        Ok(Self {
            mode,
            instance,
            second,
            owner,
            human,
            profile,
            other_profile,
            other_human,
            agent_id,
            agent_grant_id: agent.grant_id,
            agent_token: agent.token,
            observer_token: observer.token,
            note_negative_token,
            base,
            other_base,
            run_id,
            original,
            expected_bytes: bytes,
            expected,
            expected_other,
            append_text,
        })
    }
    fn connection(&self, agent: &Path) -> Result<Value> {
        if self.mode == FixtureMode::SummaryProducer {
            self.producer_connection(agent)
        } else {
            self.note_connection(agent)
        }
    }
    fn note_connection(&self, agent: &Path) -> Result<Value> {
        let status = host(self.instance.status())?;
        Ok(json!({
            "protocol": PROTOCOL, "run_id": self.run_id, "phase": "read_append_export_then_revoke",
            "http_protocol": "exomind-beta/1", "base_url": self.base, "other_instance_url": self.other_base,
            "device_id": status.device_id, "runtime_id": status.runtime_id,
            "profile_id": self.profile, "other_profile_id": self.other_profile,
            "agent_token": self.agent_token, "observer_token": self.observer_token,
            "original": { "original_id": self.original.original_id, "byte_length": self.original.byte_length, "sha256": self.original.sha256 },
            "output_directory": agent, "workflow": {
                "scope": "Only this directory and supplied loopback HTTP. Do not inspect parent/broker/Host files or owner credentials. Never print tokens. After final-result publication stop all HTTP requests.",
                "access_check": {"method":"POST","path":"/beta/v1/profiles/P/access/check","required":["events_read","receipts_read","originals_read","capture_append_agent_note"],"observer_required":["events_read","originals_read"],"source_interface":"The newly compiled Host includes access/check; the Beta04 APK is not the interface under this test."},
                "source_export": "Read original human captures with fixed highwater, limit<=100, explicit before/through until next_before=null. Export all actual records before your append; no expected ID list is provided.",
                "source_count": SOURCE_COUNT, "minimum_pages": 3, "minimum_original_chunks": 2,
                "append": {"text": self.append_text, "tags": ["classification", "external-agent", "synthetic"], "originals": [], "ids": "Generate command/event UUID once, keep exact payload for receipt lookup/replay; never generate another after uncertainty."},
                "exports": {"markdown": "agent-export.md", "manifest": "agent-export-manifest.json", "original": "exported-original.bin", "protocol": EXPORT_PROTOCOL, "manifest_fields": ["protocol", "run_id", "profile_id", "device_id", "runtime_id", "client_side_export", "server_wait_api", "server_export_bundle_api", "external_summary_append", "source_snapshot", "records", "original", "markdown_relative_path"], "source_snapshot": {"highwater": "actual first page highwater", "complete": true, "pages_read": "actual integer >=3"}, "records": "The actual 250 EventRecord objects, not IDs/counts or re-created expected text.", "original_entry": {"original_id": "actual UUID", "byte_length": ORIGINAL_LENGTH, "sha256": "actual verified SHA", "relative_path": "exported-original.bin", "state": "verified_exported"}, "markdown_relative_path": "agent-export.md", "unsupported_flags": "client_side_export=true; server_wait_api/server_export_bundle_api/external_summary_append=false. This is a bounded client export, no server bundle/wait or external summary."},
                "ready_file": "ready-to-revoke.json", "ready_fields": ["protocol", "run_id", "phase", "append_command", "append_receipt", "observed_statuses"], "ready_phase": "ready_to_revoke", "observed_statuses": {"observer_write":403,"wrong_profile":403,"wrong_instance":401,"unknown_capability":400,"wait_capability":403,"export_bundle_capability":403,"external_summary_capability":403,"forged_author":400},
                "after_ready": "Broker independently validates real facts/files, revokes agent grant, then writes revoked.json. Poll only that local file with a finite deadline; this is not a Beta wait API.",
                "final_file": "final-result.json", "final_fields": ["protocol", "run_id", "phase", "ok", "revoked_read_status", "revoked_append_status", "observer_read_status"], "final_phase": "after_revocation", "final_statuses": {"revoked_read_status":401,"revoked_append_status":401,"observer_read_status":200},
                "publication": "Write JSON/export files completely, then publish handshake JSON atomically. No business deletion/cleanup, model calls, Human impersonation or reads outside the granted P.",
                "business_budget_seconds": 260, "http_timeout_seconds": 3
            }
        }))
    }
    fn validate_ready(&self, ready: &Ready) -> Result<()> {
        require(
            ready.protocol == PROTOCOL
                && ready.run_id == self.run_id
                && ready.phase == "ready_to_revoke",
            "ready handshake scope mismatch",
        )?;
        let command = &ready.append_command;
        require(
            command.profile_id == self.profile
                && command.text == self.append_text
                && command.originals.is_empty(),
            "append payload is outside fixed classification scope",
        )?;
        let tags: HashSet<_> = command.tags.iter().map(String::as_str).collect();
        require(
            command.tags.len() == 3
                && tags == HashSet::from(["classification", "external-agent", "synthetic"]),
            "append tags mismatch",
        )?;
        require(
            command.command_id == ready.append_receipt.command_id
                && command.event_id == ready.append_receipt.event_id
                && ready.append_receipt.profile_id == self.profile,
            "Agent receipt binding mismatch",
        )?;
        let observed = &ready.observed_statuses;
        require(
            [
                observed.observer_write,
                observed.wrong_profile,
                observed.wait_capability,
                observed.export_bundle_capability,
                observed.external_summary_capability,
            ]
            .iter()
            .all(|status| *status == 403)
                && observed.wrong_instance == 401
                && observed.unknown_capability == 400
                && observed.forged_author == 400,
            "Agent negative-boundary report mismatch",
        )
    }
    fn validate_export(&self, agent: &Path) -> Result<()> {
        let manifest: Manifest = read_json(&agent.join("agent-export-manifest.json"))?;
        let status = host(self.instance.status())?;
        require(
            manifest.protocol == EXPORT_PROTOCOL
                && manifest.run_id == self.run_id
                && manifest.profile_id == self.profile
                && manifest.device_id == status.device_id
                && manifest.runtime_id == status.runtime_id,
            "export scope mismatch",
        )?;
        require(
            manifest.client_side_export
                && !manifest.server_wait_api
                && !manifest.server_export_bundle_api
                && manifest.external_summary_append == (self.mode == FixtureMode::SummaryProducer),
            "export falsely advertises an unavailable server capability",
        )?;
        require(
            manifest.source_snapshot.complete
                && (3..=16).contains(&manifest.source_snapshot.pages_read),
            "source pagination was not explicitly complete/bounded",
        )?;
        let maximum = self
            .expected
            .iter()
            .map(|record| record.local_seq)
            .max()
            .ok_or("empty broker source")?;
        require(
            manifest.source_snapshot.highwater == maximum && manifest.records.len() == SOURCE_COUNT,
            "export snapshot/count mismatch",
        )?;
        require(
            fact_map(&manifest.records)? == fact_map(&self.expected)?,
            "exported ID/payload/digest set does not match actual broker facts",
        )?;
        require(
            manifest.markdown_relative_path == "agent-export.md"
                && manifest.original.relative_path == "exported-original.bin",
            "export path is not the agreed single file name",
        )?;
        require(
            manifest.original.original_id == self.original.original_id
                && manifest.original.byte_length == self.original.byte_length
                && manifest.original.sha256 == self.original.sha256
                && manifest.original.state == "verified_exported",
            "exported original manifest mismatch",
        )?;
        let bytes = read_bounded(&agent.join("exported-original.bin"), ORIGINAL_LENGTH)?;
        require(
            bytes == self.expected_bytes
                && format!("{:x}", Sha256::digest(&bytes)) == self.original.sha256,
            "exported original bytes/hash mismatch",
        )?;
        let markdown = String::from_utf8(read_bounded(
            &agent.join("agent-export.md"),
            MARKDOWN_LIMIT,
        )?)
        .map_err(|_| "Markdown export is not UTF-8")?;
        require(
            self.expected.iter().all(|record| {
                markdown.contains(&record.event_id.to_string()) && markdown.contains(&record.text)
            }),
            "Markdown omitted source IDs or actual text",
        )
    }
    fn validate_facts(&self, ready: &Ready) -> Result<()> {
        let current = facts(&self.instance, &self.human, self.profile)?;
        require(
            current.len() == SOURCE_COUNT + 1,
            "unexpected added/deleted/duplicate P facts",
        )?;
        let note = current
            .iter()
            .find(|record| record.event_id == ready.append_command.event_id)
            .ok_or("Agent append fact is absent")?;
        let note_tags: HashSet<_> = note.tags.iter().map(String::as_str).collect();
        require(
            note.profile_id == self.profile
                && note.device_id == host(self.instance.status())?.device_id
                && note.author_kind == AuthorKind::AgentNote
                && note.author_id.to_string() == self.agent_id.to_string()
                && note.text == self.append_text
                && note.occurred_at_ms == ready.append_command.occurred_at_ms
                && note_tags == HashSet::from(["classification", "external-agent", "synthetic"])
                && note.originals.is_empty()
                && note.digest == ready.append_receipt.event_digest
                && note.local_seq == ready.append_receipt.local_seq,
            "real append author/payload/receipt mismatch",
        )?;
        let sources: Vec<_> = current
            .into_iter()
            .filter(|record| record.event_id != ready.append_command.event_id)
            .collect();
        self.validate_sources(&sources)
    }
    fn validate_sources(&self, sources: &[EventRecord]) -> Result<()> {
        require(
            fact_map(sources)? == fact_map(&self.expected)?,
            "source facts were changed or lost",
        )?;
        require(
            fact_map(&facts(
                &self.instance,
                &self.other_human,
                self.other_profile,
            )?)? == fact_map(&self.expected_other)?,
            "private Q facts changed",
        )?;
        let mut actual_bytes = Vec::new();
        while actual_bytes.len() < ORIGINAL_LENGTH {
            let length = (ORIGINAL_LENGTH - actual_bytes.len()).min(MAX_ORIGINAL_CHUNK_BYTES);
            let chunk = host(self.instance.read_original_range(
                &self.human,
                self.profile,
                self.original.original_id,
                actual_bytes.len() as u64,
                length,
            ))?;
            require(
                chunk.bytes.len() == length,
                "source original range became incomplete",
            )?;
            actual_bytes.extend(chunk.bytes);
        }
        require(
            actual_bytes == self.expected_bytes,
            "source original was damaged after Agent reads",
        )
    }
    async fn verify_boundaries(&self, client: &reqwest::Client, ready: &Ready) -> Result<()> {
        let capture = format!("{}/beta/v1/capture", self.base);
        response_status(
            client
                .post(&capture)
                .bearer_auth(&self.observer_token)
                .json(&ready.append_command),
            403,
        )
        .await?;
        response_status(
            client
                .get(format!(
                    "{}/beta/v1/profiles/{}/events",
                    self.base, self.other_profile
                ))
                .bearer_auth(&self.agent_token),
            403,
        )
        .await?;
        response_status(
            client
                .get(format!(
                    "{}/beta/v1/profiles/{}/events",
                    self.other_base, self.profile
                ))
                .bearer_auth(&self.agent_token),
            401,
        )
        .await?;
        let access = format!(
            "{}/beta/v1/profiles/{}/access/check",
            self.base, self.profile
        );
        response_status(
            client
                .post(&access)
                .bearer_auth(&self.agent_token)
                .json(&json!({"required":["made_up_capability"]})),
            400,
        )
        .await?;
        for capability in ["wait", "export_bundle", "external_summary_append"] {
            response_status(
                client
                    .post(&access)
                    .bearer_auth(&self.agent_token)
                    .json(&json!({"required":[capability]})),
                403,
            )
            .await?;
        }
        let mut forged = serde_json::to_value(&ready.append_command)
            .map_err(|_| "cannot encode negative payload")?;
        forged["author_kind"] = json!("human");
        response_status(
            client
                .post(&capture)
                .bearer_auth(&self.agent_token)
                .json(&forged),
            400,
        )
        .await?;
        let receipt = client
            .get(format!(
                "{}/beta/v1/profiles/{}/receipts/{}",
                self.base, self.profile, ready.append_command.command_id
            ))
            .bearer_auth(&self.observer_token)
            .send()
            .await
            .map_err(|_| "receipt HTTP read failed")?;
        require(receipt.status().as_u16() == 200, "actual receipt is absent")?;
        let actual: Receipt = receipt
            .json()
            .await
            .map_err(|_| "actual receipt response invalid")?;
        let mut persisted = serde_json::to_value(actual).map_err(|_| "receipt encoding failed")?;
        let mut claimed =
            serde_json::to_value(&ready.append_receipt).map_err(|_| "receipt encoding failed")?;
        // A successful same-ID replay can report replayed=true even though the
        // stored receipt reports false. The immutable receipt binding must match.
        persisted
            .as_object_mut()
            .ok_or("receipt is not an object")?
            .remove("replayed");
        claimed
            .as_object_mut()
            .ok_or("receipt is not an object")?
            .remove("replayed");
        require(
            persisted == claimed,
            "Agent supplied receipt differs from real HTTP receipt",
        )
    }
    async fn run(&self, root: &Path, action_deadline: Instant) -> Result<Value> {
        let agent = root.join("agent");
        fs::create_dir(&agent).map_err(|_| "cannot create Agent channel")?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(1))
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(|_| "cannot construct bounded HTTP client")?;
        // Do not hand an Agent an old packaged interface and then mistake its
        // 404 for a grant failure. This fixture uses the new compiled Host API.
        let preflight = client
            .post(format!("{}/beta/v1/profiles/{}/access/check", self.base, self.profile))
            .bearer_auth(&self.agent_token)
            .json(&json!({"required":["events_read","receipts_read","originals_read",self.mode.append_capability()]}))
            .send().await.map_err(|_| "new Host access preflight request failed")?;
        require(
            preflight.status().as_u16() == 200,
            "compiled Host lacks the required real access API",
        )?;
        let access: Value = preflight
            .json()
            .await
            .map_err(|_| "Host access preflight response invalid")?;
        let actual_status = host(self.instance.status())?;
        require(
            access["protocol"] == "exomind-beta/1"
                && access["profile_id"] == self.profile.to_string()
                && access["device_id"] == actual_status.device_id.to_string()
                && access["runtime_id"] == actual_status.runtime_id.to_string()
                && access["grant_kind"] == self.mode.label(),
            "Host access preflight identity mismatch",
        )?;
        write_new_json(&root.join("broker").join("access-preflight.json"), &access)?;
        write_new_json(
            &agent.join("agent-connection.json"),
            &self.connection(&agent)?,
        )?;
        wait_file(&agent.join("ready-to-revoke.json"), &agent, action_deadline).await?;
        if self.mode == FixtureMode::SummaryProducer {
            return self
                .run_producer_after_ready(root, &agent, &client, action_deadline)
                .await;
        }
        let ready: Ready = read_json(&agent.join("ready-to-revoke.json"))?;
        self.validate_ready(&ready)?;
        self.validate_export(&agent)?;
        self.validate_facts(&ready)?;
        self.verify_boundaries(&client, &ready).await?;
        host(self.instance.revoke_grant(&self.owner, self.agent_grant_id))?;
        response_status(
            client
                .get(format!(
                    "{}/beta/v1/profiles/{}/events",
                    self.base, self.profile
                ))
                .bearer_auth(&self.agent_token),
            401,
        )
        .await?;
        response_status(
            client
                .get(format!(
                    "{}/beta/v1/profiles/{}/events",
                    self.base, self.profile
                ))
                .bearer_auth(&self.observer_token),
            200,
        )
        .await?;
        write_new_json(
            &agent.join("revoked.json"),
            &json!({"protocol":PROTOCOL,"run_id":self.run_id,"phase":"agent_grant_revoked","revoked":true,"observer_still_valid":true}),
        )?;
        wait_file(&agent.join("final-result.json"), &agent, action_deadline).await?;
        let final_result: FinalResult = read_json(&agent.join("final-result.json"))?;
        require(
            final_result.protocol == PROTOCOL
                && final_result.run_id == self.run_id
                && final_result.phase == "after_revocation"
                && final_result.ok
                && final_result.revoked_read_status == 401
                && final_result.revoked_append_status == 401
                && final_result.observer_read_status == 200,
            "final Agent revocation report mismatch",
        )?;
        let events = format!("{}/beta/v1/profiles/{}/events", self.base, self.profile);
        response_status(client.get(&events).bearer_auth(&self.agent_token), 401).await?;
        response_status(
            client
                .post(format!("{}/beta/v1/capture", self.base))
                .bearer_auth(&self.agent_token)
                .json(&ready.append_command),
            401,
        )
        .await?;
        response_status(client.get(&events).bearer_auth(&self.observer_token), 200).await?;
        self.validate_export(&agent)?;
        self.validate_facts(&ready)?;
        require(
            host(self.second.status())?.device_id != host(self.instance.status())?.device_id,
            "wrong-instance Host was not independent",
        )?;
        Ok(
            json!({"protocol":PROTOCOL,"run_id":self.run_id,"ok":true,"source_records":SOURCE_COUNT,"agent_notes":1,"original_bytes":ORIGINAL_LENGTH,"client_side_export":true,"server_wait_api":false,"server_export_bundle_api":false,"external_summary_append":false,"source_set_and_originals_preserved":true,"revocation_independently_verified":true}),
        )
    }
}

impl Broker {
    fn producer_connection(&self, agent: &Path) -> Result<Value> {
        let mut value = self.note_connection(agent)?;
        let scope = value["workflow"]["scope"].clone();
        let mut exports = value["workflow"]["exports"].clone();
        exports["unsupported_flags"] = json!(
            "client_side_export=true; server_wait_api/server_export_bundle_api=false; external_summary_append=true for this grant. Export verification does not prove original body understanding in a summary."
        );
        value["phase"] = json!("read_typed_summary_export_then_revoke");
        value["grant_kind"] = json!("summary_producer");
        let negative_owner_head = Uuid::new_v4();
        value["workflow"] = json!({
            "scope":scope,"access_check":{"method":"POST","path":"/beta/v1/profiles/P/access/check","required":["events_read","timeline_read","receipts_read","originals_read","external_summary_append"],"observer_required":["events_read","originals_read"],"identity":"Check same device/runtime/P and grant_kind=summary_producer. Its returned agent_id is the real producer identity."},
            "source_export":"Read original human captures before append: fixed first highwater; limit<=100; before=next_before; same through until null. At least 3 pages. Save actual EventRecord objects, not a synthetic ID/expected table.",
            "source_count":SOURCE_COUNT,"minimum_pages":3,"minimum_original_chunks":2,"exports":exports,
            "typed_append":{"method":"POST","path":"/beta/v1/profiles/P/external-summaries","command_fields":["command_id","event_id","profile_id","occurred_at_ms","observed_through","sources","narrative","evidence"],"sources":"All 250 actual human captures as {event_id,kind:capture,digest}; unique. Never copy private broker facts or invent IDs.","observed_through":"Actual original-source first page highwater, not a wall clock or later receiver position.","narrative":self.append_text,"evidence":"At least one unique real source event ID, subset of submitted sources.","identity":"Generate fixed command/event UUID once. Do not send producer_agent_id/author/current/coverage/material/model/task/run fields.","replay":"POST the exact same command again and retain the replayed=true receipt. Do not generate another UUID. GET receipts/COMMAND may report replayed=false; compare immutable receipt fields.","readback":"GET timeline/events/EVENT must return kind agent_summary/1, not capture or internal summary/1. Read paged timeline and locate that same ID.","coverage":"Snapshot derived by Core: explicit_sources/not_attested/unknown; original metadata all unread even though this client separately downloaded/hash-verified bytes. No internal model job or current/succeeded claim."},
            "request_construction":{
                "headers":{"Content-Type":"application/json","Authorization":"Bearer token chosen by authorization_token_key from this connection"},
                "literal_body":"If body is present, send it unchanged. UUIDs below are valid synthetic IDs; referenced business objects need not exist because the correct Producer must fail role admission first.",
                "derived_body":"If body_source=saved_append_command, deep-clone your actual fixed external-summary command already successfully sent. Apply only body_patch fields when present. Do not send body_source/body_patch/authorization_token_key as API JSON fields.",
                "owner_head":"expected_owner_control_event_id and expected_control_heads contain synthetic event UUIDs, not owner credentials. Never request/read an owner token.",
                "timer_scope":"Timer HTTP CommandBody has no profile_id: P is in the route. Adding profile_id to timer JSON causes 400 before authorization and is not this test. Model request/control DO require profile_id in JSON."
            },
            "negative_cases":{
                "producer_capture":{"method":"POST","url":format!("{}/beta/v1/capture",self.base),"authorization_token_key":"agent_token","body":{"command_id":Uuid::new_v4(),"event_id":Uuid::new_v4(),"profile_id":self.profile,"occurred_at_ms":1,"text":"Synthetic denied Producer capture","tags":[],"originals":[]},"expected_status":403},
                "producer_stage":{"method":"PUT","url":format!("{}/beta/v1/profiles/{}/stages/{}",self.base,self.profile,Uuid::new_v4()),"authorization_token_key":"agent_token","body":{"original_id":Uuid::new_v4(),"expected_sha256":"a".repeat(64),"byte_length":1,"file_name":"denied-producer.bin","media_type":"application/octet-stream"},"expected_status":403},
                "producer_timer":{"method":"POST","url":format!("{}/beta/v1/profiles/{}/timeblocks/commands",self.base,self.profile),"authorization_token_key":"agent_token","body":{"command_id":Uuid::new_v4(),"event_id":Uuid::new_v4(),"expected_revision":"a".repeat(64),"action":{"kind":"pause","block_id":Uuid::new_v4()}},"expected_status":403,"note":"No profile_id in this HTTP body; route supplies scope."},
                "producer_model_request":{"method":"POST","url":format!("{}/beta/v1/profiles/{}/summaries/requests",self.base,self.profile),"authorization_token_key":"agent_token","body":{"command_id":Uuid::new_v4(),"event_id":Uuid::new_v4(),"profile_id":self.profile,"purpose":"manual_compress_v1","artifact_kind":"compressed_message","selection":{"block_ids":[Uuid::new_v4()],"from_ms":0,"to_ms":1,"selected_original_ids":[]}},"expected_status":403},
                "producer_model_control":{"method":"POST","url":format!("{}/beta/v1/profiles/{}/summaries/controls",self.base,self.profile),"authorization_token_key":"agent_token","body":{"command_id":Uuid::new_v4(),"event_id":Uuid::new_v4(),"profile_id":self.profile,"task_id":Uuid::new_v4(),"expected_owner_generation":1,"expected_owner_control_event_id":negative_owner_head,"expected_control_heads":[negative_owner_head],"action":{"kind":"cancel"}},"expected_status":403},
                "observer_append":{"method":"POST","url":format!("{}/beta/v1/profiles/{}/external-summaries",self.base,self.profile),"authorization_token_key":"observer_token","body_source":"saved_append_command","expected_status":403},
                "wrong_profile":{"method":"POST","url":format!("{}/beta/v1/profiles/{}/external-summaries",self.base,self.other_profile),"authorization_token_key":"agent_token","body_source":"saved_append_command","expected_status":403,"also_check":{"body_patch":{"profile_id":self.other_profile},"expected_status":403}},
                "wrong_instance":{"method":"POST","url":format!("{}/beta/v1/profiles/{}/external-summaries",self.other_base,self.profile),"authorization_token_key":"agent_token","body_source":"saved_append_command","expected_status":401},
                "unknown_capability":{"method":"POST","url":format!("{}/beta/v1/profiles/{}/access/check",self.base,self.profile),"authorization_token_key":"agent_token","body":{"required":["made_up_capability"]},"expected_status":400},
                "forged_author":{"method":"POST","url":format!("{}/beta/v1/profiles/{}/external-summaries",self.base,self.profile),"authorization_token_key":"agent_token","body_source":"saved_append_command","body_patch":{"producer_agent_id":self.agent_id},"expected_status":400},
                "agent_note_role":{"performed_by":"broker","expected_status":403,"note":"Broker independently verifies AgentNote cannot append typed summary; its token stays private and is not needed by the Actor."}
            },
            "ready_file":"ready-to-revoke.json","ready_fields":["protocol","run_id","phase","append_command","append_receipt","replay_receipt","observed_statuses"],"ready_phase":"ready_to_revoke","observed_statuses":{"producer_capture":403,"producer_stage":403,"producer_timer":403,"producer_model_request":403,"producer_model_control":403,"observer_append":403,"wrong_profile":403,"wrong_instance":401,"unknown_capability":400,"forged_author":400},
            "after_ready":"Broker independently validates actual typed record/source set/unread coverage/receipt/replay and original files, then revokes producer grant and writes revoked.json. Poll only that file, with finite timeout. This is not a server wait API.",
            "final_file":"final-result.json","final_fields":["protocol","run_id","phase","ok","revoked_read_status","revoked_append_status","observer_read_status"],"final_phase":"after_revocation","final_statuses":{"revoked_read_status":401,"revoked_append_status":401,"observer_read_status":200},
            "publication":"Publish complete files atomically. After revoked, retry the same external-summary command and read with revoked producer ->401; Observer still reads. Never use legacy capture as a summary fallback, perform cleanup, call models, or claim GUI verification. Stop all HTTP after final publication.","business_budget_seconds":260,"http_timeout_seconds":3
        });
        Ok(value)
    }
    fn validate_producer_ready(&self, ready: &ProducerReady) -> Result<()> {
        require(
            ready.protocol == PROTOCOL
                && ready.run_id == self.run_id
                && ready.phase == "ready_to_revoke",
            "producer handshake scope mismatch",
        )?;
        let command = &ready.append_command;
        let highwater = self
            .expected
            .iter()
            .map(|record| record.local_seq)
            .max()
            .ok_or("source highwater absent")?;
        require(
            command.profile_id == self.profile
                && command.observed_through == highwater
                && command.narrative == self.append_text
                && command.sources.len() == SOURCE_COUNT,
            "producer command scope or fixed narrative mismatch",
        )?;
        let submitted: BTreeMap<_, _> = command
            .sources
            .iter()
            .map(|source| {
                (
                    source.event_id.to_string(),
                    (source.kind.clone(), source.digest.clone()),
                )
            })
            .collect();
        let actual: BTreeMap<_, _> = self
            .expected
            .iter()
            .map(|record| {
                (
                    record.event_id.to_string(),
                    ("capture".to_owned(), record.digest.clone()),
                )
            })
            .collect();
        require(
            submitted.len() == command.sources.len() && submitted == actual,
            "producer source ID/kind/digest set mismatch",
        )?;
        let evidence: HashSet<_> = command.evidence.iter().copied().collect();
        require(
            !evidence.is_empty()
                && evidence.len() == command.evidence.len()
                && evidence
                    .iter()
                    .all(|id| submitted.contains_key(&id.to_string())),
            "producer evidence is unbound or duplicated",
        )?;
        require(
            ready.append_receipt.command_id == command.command_id
                && ready.append_receipt.event_id == command.event_id
                && ready.append_receipt.profile_id == self.profile
                && ready.replay_receipt.replayed
                && same_receipt(&ready.append_receipt, &ready.replay_receipt),
            "producer fixed command/replay receipt binding mismatch",
        )?;
        let checks = &ready.observed_statuses;
        require(
            [
                checks.producer_capture,
                checks.producer_stage,
                checks.producer_timer,
                checks.producer_model_request,
                checks.producer_model_control,
                checks.observer_append,
                checks.wrong_profile,
            ]
            .iter()
            .all(|value| *value == 403)
                && checks.wrong_instance == 401
                && checks.unknown_capability == 400
                && checks.forged_author == 400,
            "producer negative status report mismatch",
        )
    }
    fn validate_producer_fact(
        &self,
        root: &Path,
        ready: &ProducerReady,
    ) -> Result<ExternalSummaryRecord> {
        self.validate_sources(&facts(&self.instance, &self.human, self.profile)?)?;
        let item = host(self.instance.timeline_event(
            &self.human,
            self.profile,
            ready.append_command.event_id,
        ))?
        .ok_or("producer typed fact missing")?;
        let TimelineItem::AgentSummary(record) = item else {
            return Err("producer fact was stored as wrong wire family".into());
        };
        let status = host(self.instance.status())?;
        require(
            record.profile_id == self.profile
                && record.device_id == status.device_id
                && record.producer_agent_id == self.agent_id
                && record.event_id == ready.append_command.event_id
                && record.occurred_at_ms == ready.append_command.occurred_at_ms
                && record.narrative == ready.append_command.narrative
                && record.evidence == ready.append_command.evidence
                && record.digest == ready.append_receipt.event_digest
                && record.local_seq == ready.append_receipt.local_seq,
            "actual producer identity/payload/receipt mismatch",
        )?;
        require(
            record
                .computed_digest()
                .map_err(|_| "producer canonical encoding failed")?
                == record.digest,
            "producer canonical digest mismatch",
        )?;
        require(
            record.snapshot.sources == ready.append_command.sources
                && record.snapshot.observed_through == ready.append_command.observed_through
                && record.snapshot.materials == vec![self.original.clone()]
                && record.snapshot.coverage.unread_original_ids == vec![self.original.original_id]
                && record.snapshot.coverage.remote_visibility == SummaryRemoteVisibility::Unknown
                && serde_json::to_value(record.snapshot.coverage.scope)
                    .map_err(|_| "coverage encoding failed")?
                    == "explicit_sources"
                && serde_json::to_value(record.snapshot.coverage.source_delivery)
                    .map_err(|_| "coverage encoding failed")?
                    == "not_attested",
            "actual producer frozen scope/materials/unread coverage mismatch",
        )?;
        let input_bytes = self.expected.iter().try_fold(0usize, |sum, source| {
            let mut portable = source.clone();
            portable.local_seq = 0;
            let length = serde_json::to_vec(&SummaryInputRecord::Capture(portable))
                .map_err(|_| "source encoding failed")?
                .len();
            sum.checked_add(length).ok_or("input counter overflow")
        })?;
        require(
            record.snapshot.input_encoded_bytes == input_bytes as u64 && input_bytes <= 196608,
            "producer input byte counter differs from actual sources",
        )?;
        let mut snapshot = record.snapshot.clone();
        snapshot.digest.clear();
        let digest = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&snapshot).map_err(|_| "snapshot encoding failed")?)
        );
        require(
            digest == record.snapshot.digest,
            "actual producer snapshot digest mismatch",
        )?;
        require(
            host(
                self.instance
                    .summary_tasks_page(&self.human, self.profile, None, 25),
            )?
            .items
            .is_empty(),
            "producer created an internal model task",
        )?;
        let mut before = None;
        let mut through = None;
        let mut seen = HashSet::new();
        let mut external_count = 0;
        for _ in 0..8 {
            let page = host(self.instance.timeline_page(
                &self.human,
                self.profile,
                &EventQuery {
                    before,
                    through,
                    limit: 100,
                    search: None,
                },
            ))?;
            if through.is_none() {
                through = Some(page.highwater);
            }
            for item in page.items {
                let id = match item {
                    TimelineItem::Capture(record) => record.event_id,
                    TimelineItem::AgentSummary(record) => {
                        external_count += 1;
                        require(
                            record.event_id == ready.append_command.event_id,
                            "unexpected producer fact",
                        )?;
                        record.event_id
                    }
                    _ => {
                        return Err(
                            "unexpected timeblock/internal result in producer fixture".into()
                        );
                    }
                };
                require(seen.insert(id), "duplicate typed timeline ID")?;
            }
            before = page.next_before;
            if before.is_none() {
                break;
            }
        }
        require(
            before.is_none() && seen.len() == SOURCE_COUNT + 1 && external_count == 1,
            "typed timeline omitted/duplicated producer or source data",
        )?;
        // Privileged broker-only SQL reads audit hidden side effects; all seed
        // and Agent business writes still use formal facades or real HTTP.
        let database = root.join("broker/host-a/core/beta-core.sqlite3");
        ordinary(&database, false)?;
        let connection = Connection::open_with_flags(
            database,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|_| "broker read-only side-effect audit unavailable")?;
        connection
            .busy_timeout(Duration::from_secs(3))
            .map_err(|_| "audit deadline setup failed")?;
        let counts:(i64,i64,i64,i64,i64)=connection.query_row("SELECT (SELECT count(*) FROM events WHERE kind IN ('summary_job/1','summary/1')),(SELECT count(*) FROM summary_nodes),(SELECT count(*) FROM summary_attempts),(SELECT count(*) FROM timeblock_nodes),(SELECT count(*) FROM original_stages)",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))).map_err(|_|"broker side-effect audit query failed")?;
        require(
            counts == (0, 0, 0, 0, 1),
            "producer caused an internal job/timer/stage side effect",
        )?;
        Ok(record)
    }
    async fn verify_producer_boundaries(
        &self,
        client: &reqwest::Client,
        ready: &ProducerReady,
    ) -> Result<()> {
        let external = format!(
            "{}/beta/v1/profiles/{}/external-summaries",
            self.base, self.profile
        );
        response_status(
            client
                .post(&external)
                .bearer_auth(&self.observer_token)
                .json(&ready.append_command),
            403,
        )
        .await?;
        let note = self
            .note_negative_token
            .as_ref()
            .ok_or("broker AgentNote negative grant absent")?;
        response_status(
            client
                .post(&external)
                .bearer_auth(note)
                .json(&ready.append_command),
            403,
        )
        .await?;
        response_status(
            client
                .post(format!(
                    "{}/beta/v1/profiles/{}/external-summaries",
                    self.base, self.other_profile
                ))
                .bearer_auth(&self.agent_token)
                .json(&ready.append_command),
            403,
        )
        .await?;
        let mut other_scope = ready.append_command.clone();
        other_scope.profile_id = self.other_profile;
        response_status(
            client
                .post(format!(
                    "{}/beta/v1/profiles/{}/external-summaries",
                    self.base, self.other_profile
                ))
                .bearer_auth(&self.agent_token)
                .json(&other_scope),
            403,
        )
        .await?;
        response_status(
            client
                .post(format!(
                    "{}/beta/v1/profiles/{}/external-summaries",
                    self.other_base, self.profile
                ))
                .bearer_auth(&self.agent_token)
                .json(&ready.append_command),
            401,
        )
        .await?;
        let legacy = CaptureCommand {
            command_id: ready.append_command.command_id,
            event_id: ready.append_command.event_id,
            profile_id: self.profile,
            occurred_at_ms: ready.append_command.occurred_at_ms,
            text: self.append_text.clone(),
            tags: vec![],
            originals: vec![],
        };
        response_status(
            client
                .post(format!("{}/beta/v1/capture", self.base))
                .bearer_auth(&self.agent_token)
                .json(&legacy),
            403,
        )
        .await?;
        response_status(client.put(format!("{}/beta/v1/profiles/{}/stages/{}",self.base,self.profile,Uuid::new_v4())).bearer_auth(&self.agent_token).json(&json!({"original_id":Uuid::new_v4(),"expected_sha256":"a".repeat(64),"byte_length":1,"file_name":"negative.bin","media_type":"application/octet-stream"})),403).await?;
        let control_ids = json!({"command_id":Uuid::new_v4(),"event_id":Uuid::new_v4(),"expected_revision":"0".repeat(64),"action":{"kind":"pause","block_id":Uuid::new_v4()}});
        response_status(
            client
                .post(format!(
                    "{}/beta/v1/profiles/{}/timeblocks/commands",
                    self.base, self.profile
                ))
                .bearer_auth(&self.agent_token)
                .json(&control_ids),
            403,
        )
        .await?;
        response_status(client.post(format!("{}/beta/v1/profiles/{}/summaries/requests",self.base,self.profile)).bearer_auth(&self.agent_token).json(&json!({"command_id":Uuid::new_v4(),"event_id":Uuid::new_v4(),"profile_id":self.profile,"purpose":"manual_compress_v1","artifact_kind":"review","selection":{"block_ids":[Uuid::new_v4()],"from_ms":0,"to_ms":1,"selected_original_ids":[]}})),403).await?;
        response_status(client.post(format!("{}/beta/v1/profiles/{}/summaries/controls",self.base,self.profile)).bearer_auth(&self.agent_token).json(&json!({"command_id":Uuid::new_v4(),"event_id":Uuid::new_v4(),"profile_id":self.profile,"task_id":Uuid::new_v4(),"expected_owner_generation":1,"expected_owner_control_event_id":Uuid::new_v4(),"expected_control_heads":[],"action":{"kind":"cancel"}})),403).await?;
        response_status(
            client
                .post(format!(
                    "{}/beta/v1/profiles/{}/access/check",
                    self.base, self.profile
                ))
                .bearer_auth(&self.agent_token)
                .json(&json!({"required":["made_up_capability"]})),
            400,
        )
        .await?;
        let mut forged = serde_json::to_value(&ready.append_command)
            .map_err(|_| "producer negative encoding failed")?;
        forged["producer_agent_id"] = json!(self.agent_id);
        response_status(
            client
                .post(&external)
                .bearer_auth(&self.agent_token)
                .json(&forged),
            400,
        )
        .await?;
        let response = client
            .get(format!(
                "{}/beta/v1/profiles/{}/receipts/{}",
                self.base, self.profile, ready.append_command.command_id
            ))
            .bearer_auth(&self.observer_token)
            .send()
            .await
            .map_err(|_| "producer receipt lookup failed")?;
        require(
            response.status().as_u16() == 200,
            "producer actual receipt missing",
        )?;
        let actual: Receipt = response
            .json()
            .await
            .map_err(|_| "producer receipt invalid")?;
        require(
            same_receipt(&actual, &ready.append_receipt),
            "producer receipt differs from actual store",
        )?;
        let exact = client
            .get(format!(
                "{}/beta/v1/profiles/{}/timeline/events/{}",
                self.base, self.profile, ready.append_command.event_id
            ))
            .bearer_auth(&self.observer_token)
            .send()
            .await
            .map_err(|_| "producer exact HTTP read failed")?;
        require(
            exact.status().as_u16() == 200,
            "producer exact HTTP read denied",
        )?;
        let exact: Value = exact
            .json()
            .await
            .map_err(|_| "producer exact HTTP response invalid")?;
        require(
            exact["kind"] == "agent_summary/1",
            "producer exact HTTP read returned a legacy family",
        )?;
        let decoded: ExternalSummaryRecord = serde_json::from_value(exact["record"].clone())
            .map_err(|_| "producer HTTP record schema invalid")?;
        require(
            decoded.event_id == ready.append_command.event_id
                && decoded.producer_agent_id == self.agent_id
                && decoded.digest == ready.append_receipt.event_digest
                && decoded
                    .computed_digest()
                    .map_err(|_| "producer HTTP canonical encoding invalid")?
                    == decoded.digest,
            "producer exact HTTP identity/digest mismatch",
        )?;
        let timeline = client
            .get(format!(
                "{}/beta/v1/profiles/{}/timeline?limit=100",
                self.base, self.profile
            ))
            .bearer_auth(&self.observer_token)
            .send()
            .await
            .map_err(|_| "producer paged HTTP timeline failed")?;
        require(
            timeline.status().as_u16() == 200,
            "producer paged HTTP timeline denied",
        )?;
        let timeline: Value = timeline
            .json()
            .await
            .map_err(|_| "producer paged HTTP response invalid")?;
        require(
            timeline["items"].as_array().is_some_and(|items| {
                items.len() == 100
                    && items.iter().any(|item| {
                        item["kind"] == "agent_summary/1"
                            && item["record"]["event_id"]
                                == ready.append_command.event_id.to_string()
                    })
            }) && !timeline["next_before"].is_null(),
            "producer paged HTTP timeline omitted typed fact or remainder",
        )?;
        let replay = client
            .post(&external)
            .bearer_auth(&self.agent_token)
            .json(&ready.append_command)
            .send()
            .await
            .map_err(|_| "producer same-ID replay failed")?;
        require(
            replay.status().as_u16() == 200,
            "producer same-ID replay rejected",
        )?;
        let replay: Receipt = replay
            .json()
            .await
            .map_err(|_| "producer replay receipt invalid")?;
        require(
            replay.replayed && same_receipt(&replay, &ready.append_receipt),
            "producer replay changed immutable receipt",
        )
    }
    async fn run_producer_after_ready(
        &self,
        root: &Path,
        agent: &Path,
        client: &reqwest::Client,
        deadline: Instant,
    ) -> Result<Value> {
        let ready: ProducerReady = read_json(&agent.join("ready-to-revoke.json"))?;
        self.validate_producer_ready(&ready)?;
        self.validate_export(agent)?;
        let first = self.validate_producer_fact(root, &ready)?;
        self.verify_producer_boundaries(client, &ready).await?;
        self.validate_producer_fact(root, &ready)?;
        host(self.instance.revoke_grant(&self.owner, self.agent_grant_id))?;
        let events = format!("{}/beta/v1/profiles/{}/events", self.base, self.profile);
        response_status(client.get(&events).bearer_auth(&self.agent_token), 401).await?;
        response_status(client.get(&events).bearer_auth(&self.observer_token), 200).await?;
        write_new_json(
            &agent.join("revoked.json"),
            &json!({"protocol":PROTOCOL,"run_id":self.run_id,"phase":"producer_grant_revoked","revoked":true,"observer_still_valid":true}),
        )?;
        wait_file(&agent.join("final-result.json"), agent, deadline).await?;
        let final_result: FinalResult = read_json(&agent.join("final-result.json"))?;
        require(
            final_result.protocol == PROTOCOL
                && final_result.run_id == self.run_id
                && final_result.phase == "after_revocation"
                && final_result.ok
                && final_result.revoked_read_status == 401
                && final_result.revoked_append_status == 401
                && final_result.observer_read_status == 200,
            "producer final revocation report mismatch",
        )?;
        response_status(client.get(&events).bearer_auth(&self.agent_token), 401).await?;
        response_status(
            client
                .post(format!(
                    "{}/beta/v1/profiles/{}/external-summaries",
                    self.base, self.profile
                ))
                .bearer_auth(&self.agent_token)
                .json(&ready.append_command),
            401,
        )
        .await?;
        response_status(client.get(&events).bearer_auth(&self.observer_token), 200).await?;
        self.validate_export(agent)?;
        let last = self.validate_producer_fact(root, &ready)?;
        require(
            first.digest == last.digest
                && first.snapshot.digest == last.snapshot.digest
                && first
                    .canonical_fact_bytes()
                    .map_err(|_| "producer canonical read failed")?
                    == last
                        .canonical_fact_bytes()
                        .map_err(|_| "producer canonical read failed")?,
            "producer historical bytes changed during replay/revocation",
        )?;
        require(
            host(self.second.status())?.device_id != host(self.instance.status())?.device_id,
            "producer wrong-instance Host not independent",
        )?;
        Ok(
            json!({"protocol":PROTOCOL,"run_id":self.run_id,"ok":true,"mode":"summary_producer","source_records":SOURCE_COUNT,"typed_external_summaries":1,"agent_notes":0,"internal_jobs":0,"original_bytes":ORIGINAL_LENGTH,"client_side_export":true,"server_wait_api":false,"server_export_bundle_api":false,"external_summary_append":true,"source_set_and_originals_preserved":true,"revocation_independently_verified":true,"gui_verified":false}),
        )
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "Requires explicit new private QA directory and a real external Agent file handshake; never default/live data"]
async fn external_agent_reads_exports_appends_and_loses_revoked_authority() {
    run_fixture(FixtureMode::AgentNote).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "Requires explicit new EXOMIND_BETA_EXTERNAL_PRODUCER_QA_DIR and real low-grant Agent; not a GUI test"]
async fn external_producer_appends_typed_summary_and_loses_revoked_authority() {
    run_fixture(FixtureMode::SummaryProducer).await;
}

async fn run_fixture(mode: FixtureMode) {
    let began = Instant::now();
    let action_deadline = began + Duration::from_secs(260);
    let mut servers = Vec::new();
    let mut root = None;
    let result = timeout_at(action_deadline, async {
        let directory = fresh_private_root(mode.env_key()).await?;
        root = Some(directory.clone());
        let broker = Broker::setup(&directory, &mut servers, mode).await?;
        broker.run(&directory, action_deadline).await
    })
    .await
    .unwrap_or_else(|_| Err("fixture action deadline exceeded".into()));
    // Preserve error evidence and always stop only the two listeners created
    // above. RunningServer's Drop also closes admission/its own task on error.
    let mut cleanup_ok = true;
    for server in servers.into_iter().rev() {
        let stop = timeout_at(
            (Instant::now() + Duration::from_secs(9)).min(began + Duration::from_secs(290)),
            server.stop(),
        )
        .await;
        cleanup_ok &= matches!(stop, Ok(Ok(())));
    }
    let terminal = match &result {
        Ok(proof) => {
            json!({"protocol":PROTOCOL,"ok":cleanup_ok,"proof":proof,"cleanup_confirmed":cleanup_ok})
        }
        Err(code) => {
            json!({"protocol":PROTOCOL,"ok":false,"error":code,"cleanup_confirmed":cleanup_ok})
        }
    };
    if let Some(directory) = &root {
        let _ = write_new_json(&directory.join("broker-terminal.json"), &terminal);
    }
    assert!(
        result.is_ok() && cleanup_ok && began.elapsed() <= Duration::from_secs(300),
        "external Agent fixture or owned cleanup failed; inspect private broker-terminal.json (no credentials printed)"
    );
}
