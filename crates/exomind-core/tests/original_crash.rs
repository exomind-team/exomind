use exomind_core::{
    BeginStageCommand, CaptureCommand, CommandId, Core, EventId, OriginalId, ProfileId, StageId,
    StageState,
};
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    time::{Duration, Instant},
};

#[test]
fn actual_process_kill_recovers_acknowledged_chunks_frozen_verified_and_committed_states() {
    for phase in ["chunk", "frozen", "verified", "capture"] {
        let work = tempfile::tempdir().unwrap();
        let root = work.path().join("core");
        let profile = ProfileId::new();
        let stage = StageId::new();
        let original = OriginalId::new();
        let ready = work.path().join("ready");
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "original_crash_child",
                "--ignored",
                "--nocapture",
            ])
            .env("EXOMIND_ORIGINAL_CRASH_ROOT", &root)
            .env("EXOMIND_ORIGINAL_CRASH_READY", &ready)
            .env("EXOMIND_ORIGINAL_CRASH_PHASE", phase)
            .env("EXOMIND_ORIGINAL_CRASH_PROFILE", profile.to_string())
            .env("EXOMIND_ORIGINAL_CRASH_STAGE", stage.to_string())
            .env("EXOMIND_ORIGINAL_CRASH_ORIGINAL", original.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        while !ready.exists() && Instant::now() < deadline {
            if let Some(status) = child.try_wait().unwrap() {
                panic!("crash child exited before barrier: {status}");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if !ready.exists() {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("crash child did not reach {phase}");
        }
        child.kill().unwrap();
        child.wait().unwrap();
        let core = Core::open(&root).unwrap();
        let context = core.local_human(profile).unwrap();
        let status = core.stage_status(&context, stage).unwrap();
        assert_eq!(status.next_offset, 8);
        assert_eq!(
            status.state,
            match phase {
                "chunk" => StageState::Uploading,
                "frozen" => StageState::Frozen,
                _ => StageState::Verified,
            }
        );
        assert!(core.read_stage_range(&context, stage, 0, 8).unwrap().bytes == b"original");
        let events = core.events(&context, profile).unwrap();
        assert_eq!(events.len(), usize::from(phase == "capture"));
        if phase == "capture" {
            assert!(
                core.read_original_range(&context, profile, original, 0, 8)
                    .unwrap()
                    .bytes
                    == b"original"
            );
        }
    }
}

#[test]
#[ignore = "invoked only by the bounded synthetic process-kill test"]
fn original_crash_child() {
    let Ok(root) = std::env::var("EXOMIND_ORIGINAL_CRASH_ROOT") else {
        return;
    };
    let profile: ProfileId = std::env::var("EXOMIND_ORIGINAL_CRASH_PROFILE")
        .unwrap()
        .parse()
        .unwrap();
    let stage: StageId = std::env::var("EXOMIND_ORIGINAL_CRASH_STAGE")
        .unwrap()
        .parse()
        .unwrap();
    let original: OriginalId = std::env::var("EXOMIND_ORIGINAL_CRASH_ORIGINAL")
        .unwrap()
        .parse()
        .unwrap();
    let phase = std::env::var("EXOMIND_ORIGINAL_CRASH_PHASE").unwrap();
    let core = Core::open(Path::new(&root)).unwrap();
    core.provision_profile(profile, "synthetic").unwrap();
    let context = core.local_human(profile).unwrap();
    let command = BeginStageCommand {
        stage_id: stage,
        original_id: original,
        profile_id: profile,
        expected_sha256: format!("{:x}", Sha256::digest(b"original")),
        byte_length: 8,
        file_name: "unknown.xyz".into(),
        media_type: "application/octet-stream".into(),
    };
    core.begin_stage(&context, &command).unwrap();
    core.write_stage_chunk(&context, stage, 0, b"original")
        .unwrap();
    if phase != "chunk" {
        let ticket = core.freeze_stage(&context, stage).unwrap();
        if phase != "frozen" {
            let proof = ticket.verify(|| false).unwrap();
            let status = core.finish_stage(&context, &proof).unwrap();
            if phase == "capture" {
                core.submit(
                    &context,
                    &CaptureCommand {
                        command_id: CommandId::new(),
                        event_id: EventId::new(),
                        profile_id: profile,
                        occurred_at_ms: 1,
                        text: String::new(),
                        tags: vec![],
                        originals: vec![status.original],
                    },
                )
                .unwrap();
            }
        }
    }
    std::fs::write(
        std::env::var("EXOMIND_ORIGINAL_CRASH_READY").unwrap(),
        b"ready",
    )
    .unwrap();
    loop {
        std::thread::sleep(Duration::from_secs(1));
    }
}
