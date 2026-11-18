//! Application-owned commands and durable drafts shared by local presentation
//! clients. No window, DOM visibility, heartbeat or frontend executor is used.
use crate::{BetaHost, HostError, Session};
use exomind_core::{CaptureCommand, ProfileId, Receipt, TimeblockCommand};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorkspaceAction {
    Refresh,
    Pause {
        block_id: Uuid,
    },
    Resume {
        block_id: Uuid,
    },
    EndAction {
        block_id: Uuid,
    },
    CaptureEdit {
        draft_revision: u64,
        text: String,
    },
    Capture {
        draft_revision: u64,
    },
    FeedbackEdit {
        block_id: Uuid,
        draft_revision: u64,
        text: String,
    },
    SubmitFeedback {
        block_id: Uuid,
        draft_revision: u64,
        skipped: bool,
    },
    AppendFeedback {
        block_id: Uuid,
        draft_revision: u64,
    },
    RetryCapture {
        command_id: Uuid,
    },
    RetryTimeblock {
        command_id: Uuid,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    #[error(transparent)]
    Host(#[from] HostError),
    #[error("shared draft changed; retained input must be reconciled")]
    DraftConflict,
    #[error("a prior operation is still unconfirmed")]
    Pending,
    #[error("private workspace intent is invalid; original data is preserved")]
    InvalidIntent,
    #[error("the requested operation is not present in this workspace")]
    Missing,
}

struct Intent {
    key: String,
    raw: Option<String>,
    value: Value,
}
pub struct NativeWorkspace {
    host: Arc<BetaHost>,
    owner: Session,
    gate: Mutex<()>,
    sessions: Mutex<HashMap<ProfileId, Session>>,
}
impl NativeWorkspace {
    pub fn new(host: Arc<BetaHost>, owner: Session) -> Self {
        Self {
            host,
            owner,
            gate: Mutex::new(()),
            sessions: Mutex::new(HashMap::new()),
        }
    }
    /// One internal human authority per application/profile. Minting a session
    /// writes the auth store, so ordinary snapshot reads must only reuse it.
    pub fn human_session(&self, profile: ProfileId) -> Result<Session, HostError> {
        let mut sessions = self.sessions.lock().map_err(|_| HostError::StatePoisoned)?;
        if let Some(session) = sessions.get(&profile) {
            return Ok(session.clone());
        }
        let session = self.host.native_human_session(&self.owner, profile)?;
        sessions.insert(profile, session.clone());
        Ok(session)
    }
    pub fn intent_keys(&self, profile: ProfileId) -> Result<[String; 2], WorkspaceError> {
        let device = self.host.status()?.device_id.to_string();
        Ok([
            format!("exomind:beta:drafts:{device}"),
            format!(
                "exomind:beta:timeblocks:{}",
                json!([device, profile.to_string()])
            ),
        ])
    }
    fn intent(&self, profile: ProfileId, focus: bool) -> Result<Intent, WorkspaceError> {
        self.human_session(profile)?;
        let keys = self.intent_keys(profile)?;
        let key = keys[usize::from(focus)].clone();
        let raw = self.host.read_local_intent(&self.owner, &key)?;
        let value: Value = match raw.as_deref() {
            Some(raw) => serde_json::from_str(raw).map_err(|_| WorkspaceError::InvalidIntent)?,
            None if focus => {
                json!({"version":1,"draft":{"name":"","note":"","mode":"countdown","minutes":25,"endMode":"soft","revision":0},"feedback":{},"pending":[],"confirmed":[]})
            }
            None => json!({"version":1,"drafts":{},"pending":[],"confirmed":[]}),
        };
        if value["version"] != 1
            || !value["pending"].is_array()
            || !value["confirmed"].is_array()
            || !value[if focus { "feedback" } else { "drafts" }].is_object()
        {
            return Err(WorkspaceError::InvalidIntent);
        }
        Ok(Intent { key, raw, value })
    }
    fn save(&self, intent: &mut Intent) -> Result<(), WorkspaceError> {
        let raw =
            serde_json::to_string(&intent.value).map_err(|_| WorkspaceError::InvalidIntent)?;
        self.host
            .compare_local_intent(&self.owner, &intent.key, intent.raw.as_deref(), &raw)?;
        intent.raw = Some(raw);
        Ok(())
    }
    fn draft(value: Option<&Value>) -> Result<Value, WorkspaceError> {
        let draft = value
            .cloned()
            .unwrap_or_else(|| json!({"text":"","revision":0}));
        if !draft["text"].is_string()
            || draft["revision"]
                .as_u64()
                .is_none_or(|v| v >= 9_007_199_254_740_991)
        {
            return Err(WorkspaceError::InvalidIntent);
        }
        if draft.get("files").is_some_and(|files| !files.is_array()) {
            return Err(WorkspaceError::InvalidIntent);
        }
        Ok(draft)
    }
    pub fn snapshot(&self, profile: ProfileId) -> Result<Value, WorkspaceError> {
        let _gate = self.gate.lock().map_err(|_| HostError::StatePoisoned)?;
        let session = self.human_session(profile)?;
        let remote = self.host.timeblock_snapshot(&session, profile)?;
        let capture = self.intent(profile, false)?;
        let focus = self.intent(profile, true)?;
        let draft = Self::draft(capture.value["drafts"].get(profile.to_string()))?;
        let capture_pending: Vec<Value> = capture.value["pending"].as_array().ok_or(WorkspaceError::InvalidIntent)?.iter()
            .filter(|item| item["command"]["profile_id"] == profile.to_string() && item["state"] != "committed")
            .map(|item| json!({"command_id":item["command"]["command_id"],"state":if item["state"]=="pending" {json!("unknown")}else{item["state"].clone()},"message":item["message"].as_str().unwrap_or("结果待查证")})).collect();
        let focus_pending: Vec<Value> = focus.value["pending"].as_array().ok_or(WorkspaceError::InvalidIntent)?.iter()
            .map(|item| json!({"command_id":item["command"]["command_id"],"state":if item["state"]=="pending" {json!("unknown")}else{item["state"].clone()},"message":item["message"].as_str().unwrap_or("结果待查证")})).collect();
        let busy = focus_pending.iter().any(|item| item["state"] != "rejected");
        Ok(
            json!({"remote":remote,"capture":{"text":draft["text"],"revision":draft["revision"],"file_count":draft["files"].as_array().map_or(0,Vec::len),"state":"idle","error":null},
            "feedback":focus.value["feedback"],"focus_state":"idle","focus_error":null,"focus_busy":busy,"focus_pending":focus_pending,"capture_pending":capture_pending}),
        )
    }
    pub fn execute(
        &self,
        profile: ProfileId,
        command_id: Uuid,
        event_id: Uuid,
        revision: &str,
        action: &WorkspaceAction,
    ) -> Result<Option<Receipt>, WorkspaceError> {
        let _gate = self.gate.lock().map_err(|_| HostError::StatePoisoned)?;
        use WorkspaceAction::*;
        match action {
            Refresh => {
                let session = self.human_session(profile)?;
                self.host.timeblock_snapshot(&session, profile)?;
                Ok(None)
            }
            CaptureEdit {
                draft_revision,
                text,
            } => {
                let mut intent = self.intent(profile, false)?;
                let key = profile.to_string();
                let mut draft = Self::draft(intent.value["drafts"].get(&key))?;
                if draft["revision"] != *draft_revision {
                    return Err(WorkspaceError::DraftConflict);
                }
                draft["text"] = json!(text);
                draft["revision"] = json!(draft_revision + 1);
                intent.value["drafts"][&key] = draft;
                self.save(&mut intent)?;
                Ok(None)
            }
            FeedbackEdit {
                block_id,
                draft_revision,
                text,
            } => {
                let mut intent = self.intent(profile, true)?;
                let key = block_id.to_string();
                let mut draft = Self::draft(intent.value["feedback"].get(&key))?;
                let human = self.human_session(profile)?;
                let remote = self.host.timeblock_snapshot(&human, profile)?;
                if block_id.is_nil()
                    || !remote
                        .active
                        .as_ref()
                        .is_some_and(|active| active.block_id.to_string() == key)
                        && !remote
                            .pending_feedback
                            .iter()
                            .any(|id| id.to_string() == key)
                        && intent.value["feedback"].get(&key).is_none()
                {
                    return Err(WorkspaceError::Missing);
                }
                if draft["revision"] != *draft_revision {
                    return Err(WorkspaceError::DraftConflict);
                }
                draft["text"] = json!(text);
                draft["revision"] = json!(draft_revision + 1);
                intent.value["feedback"][&key] = draft;
                self.save(&mut intent)?;
                Ok(None)
            }
            Capture { draft_revision } => {
                self.capture(profile, command_id, event_id, *draft_revision)
            }
            RetryCapture { command_id } => self.retry(profile, *command_id, false),
            RetryTimeblock { command_id } => self.retry(profile, *command_id, true),
            _ => self.timeblock(profile, command_id, event_id, revision, action),
        }
    }
    fn timeblock(
        &self,
        profile: ProfileId,
        command_id: Uuid,
        event_id: Uuid,
        revision: &str,
        action: &WorkspaceAction,
    ) -> Result<Option<Receipt>, WorkspaceError> {
        let mut intent = self.intent(profile, true)?;
        if intent.value["pending"]
            .as_array()
            .ok_or(WorkspaceError::InvalidIntent)?
            .iter()
            .any(|item| item["state"] != "rejected")
        {
            return Err(WorkspaceError::Pending);
        }
        let mut link = Value::Null;
        let mut encoded =
            serde_json::to_value(action).map_err(|_| WorkspaceError::InvalidIntent)?;
        match action {
            WorkspaceAction::SubmitFeedback {
                block_id,
                draft_revision,
                ..
            }
            | WorkspaceAction::AppendFeedback {
                block_id,
                draft_revision,
            } => {
                let draft = Self::draft(intent.value["feedback"].get(block_id.to_string()))?;
                if draft["revision"] != *draft_revision {
                    return Err(WorkspaceError::DraftConflict);
                }
                let text = draft["text"]
                    .as_str()
                    .ok_or(WorkspaceError::InvalidIntent)?;
                link = json!({"kind":"feedback","block_id":block_id,"revision":draft_revision});
                encoded = match action {
                    WorkspaceAction::SubmitFeedback { skipped, .. } => {
                        json!({"kind":"submit_feedback","block_id":block_id,"feedback":if *skipped {json!({"kind":"skipped"})}else{json!({"kind":"text","text":text})}})
                    }
                    _ => json!({"kind":"append_feedback","block_id":block_id,"text":text}),
                };
            }
            _ => {}
        }
        let command:TimeblockCommand=serde_json::from_value(json!({"command_id":command_id,"event_id":event_id,"profile_id":profile,"expected_revision":revision,"action":encoded})).map_err(|_|WorkspaceError::InvalidIntent)?;
        let mut pending = json!({"command":command,"state":"unknown"});
        if !link.is_null() {
            pending["link"] = link;
        }
        intent.value["pending"]
            .as_array_mut()
            .ok_or(WorkspaceError::InvalidIntent)?
            .push(pending.clone());
        self.save(&mut intent)?;
        self.dispatch(profile, pending, true)
    }
    fn capture(
        &self,
        profile: ProfileId,
        command_id: Uuid,
        event_id: Uuid,
        revision: u64,
    ) -> Result<Option<Receipt>, WorkspaceError> {
        let mut intent = self.intent(profile, false)?;
        let draft = Self::draft(intent.value["drafts"].get(profile.to_string()))?;
        if draft["revision"] != revision {
            return Err(WorkspaceError::DraftConflict);
        }
        let files = draft["files"].as_array().cloned().unwrap_or_default();
        if files
            .iter()
            .any(|file| file["state"] != "verified" || !file["original"].is_object())
        {
            return Err(WorkspaceError::Pending);
        }
        let originals: Vec<Value> = files.iter().map(|file| file["original"].clone()).collect();
        let now = i64::try_from(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| HostError::ClockUnavailable)?
                .as_millis(),
        )
        .map_err(|_| HostError::ClockUnavailable)?;
        let command:CaptureCommand=serde_json::from_value(json!({"command_id":command_id,"event_id":event_id,"profile_id":profile,"occurred_at_ms":now,"text":draft["text"],"tags":[],"originals":originals})).map_err(|_|WorkspaceError::InvalidIntent)?;
        let pending = json!({"command":command,"draft_revision":revision,"state":"unknown","files":files,"capture_attempted":true});
        intent.value["pending"]
            .as_array_mut()
            .ok_or(WorkspaceError::InvalidIntent)?
            .push(pending.clone());
        self.save(&mut intent)?;
        self.dispatch(profile, pending, false)
    }
    fn retry(
        &self,
        profile: ProfileId,
        id: Uuid,
        focus: bool,
    ) -> Result<Option<Receipt>, WorkspaceError> {
        let intent = self.intent(profile, focus)?;
        let pending = intent.value["pending"]
            .as_array()
            .ok_or(WorkspaceError::InvalidIntent)?
            .iter()
            .find(|item| item["command"]["command_id"] == id.to_string())
            .cloned()
            .ok_or(WorkspaceError::Missing)?;
        if pending["command"]["profile_id"] != profile.to_string() {
            return Err(WorkspaceError::Missing);
        }
        self.dispatch(profile, pending, focus)
    }
    fn dispatch(
        &self,
        profile: ProfileId,
        pending: Value,
        focus: bool,
    ) -> Result<Option<Receipt>, WorkspaceError> {
        let session = self.human_session(profile)?;
        let id = pending["command"]["command_id"]
            .as_str()
            .ok_or(WorkspaceError::InvalidIntent)?
            .parse()
            .map_err(|_| WorkspaceError::InvalidIntent)?;
        let result = if let Some(receipt) = self.host.receipt(&session, profile, id)? {
            Ok(receipt)
        } else if focus {
            let command: TimeblockCommand = serde_json::from_value(pending["command"].clone())
                .map_err(|_| WorkspaceError::InvalidIntent)?;
            self.host.apply_timeblock(&session, &command)
        } else {
            let command: CaptureCommand = serde_json::from_value(pending["command"].clone())
                .map_err(|_| WorkspaceError::InvalidIntent)?;
            self.host.capture(&session, &command)
        };
        let receipt = match result {
            Ok(receipt) => receipt,
            Err(error) => {
                if focus
                    && matches!(
                        &error,
                        HostError::Core(exomind_core::CoreError::TimeblockConflict)
                    )
                {
                    let mut intent = self.intent(profile, true)?;
                    if let Some(item) = intent.value["pending"]
                        .as_array_mut()
                        .ok_or(WorkspaceError::InvalidIntent)?
                        .iter_mut()
                        .find(|item| item["command"]["command_id"] == id.to_string())
                    {
                        item["state"] = json!("rejected");
                        item["code"] = json!("timeblock_conflict");
                        item["message"] = json!("时间块已变化，此操作未生效");
                    }
                    self.save(&mut intent)?;
                }
                return Err(error.into());
            }
        };
        // Refresh after the Core transaction: a different local client may have
        // edited a newer draft meanwhile. Clear only the submitted revision.
        let mut intent = self.intent(profile, focus)?;
        intent.value["pending"]
            .as_array_mut()
            .ok_or(WorkspaceError::InvalidIntent)?
            .retain(|item| item["command"]["command_id"] != id.to_string());
        if focus {
            let link = &pending["link"];
            if link["kind"] == "feedback" {
                let key = link["block_id"]
                    .as_str()
                    .ok_or(WorkspaceError::InvalidIntent)?;
                if intent.value["feedback"][key]["revision"] == link["revision"] {
                    intent.value["feedback"][key] = json!({"text":"","revision":link["revision"].as_u64().ok_or(WorkspaceError::InvalidIntent)?+1});
                }
            }
            intent.value["confirmed"]
                .as_array_mut()
                .ok_or(WorkspaceError::InvalidIntent)?
                .push(json!(receipt));
        } else {
            let key = profile.to_string();
            if intent.value["drafts"][&key]["revision"] == pending["draft_revision"] {
                intent.value["drafts"][&key] = json!({"text":"","revision":pending["draft_revision"].as_u64().ok_or(WorkspaceError::InvalidIntent)?+1,"files":[]});
            }
            intent.value["confirmed"]
                .as_array_mut()
                .ok_or(WorkspaceError::InvalidIntent)?
                .push(json!({"receipt":receipt,"draft_revision":pending["draft_revision"]}));
        }
        let confirmed = intent.value["confirmed"]
            .as_array_mut()
            .ok_or(WorkspaceError::InvalidIntent)?;
        if confirmed.len() > 8 {
            confirmed.drain(..confirmed.len() - 8);
        }
        self.save(&mut intent)?;
        Ok(Some(receipt))
    }
}
