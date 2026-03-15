use serde::{Deserialize, Serialize};

/// Session lifecycle status.
/// Running → WaitingInput / Error / Paused → Running → Completed → Archived
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Running,
    WaitingInput,
    Completed,
    Error,
    Paused,
    Archived,
}

impl SessionStatus {
    pub fn valid_transitions(&self) -> &[SessionStatus] {
        match self {
            SessionStatus::Running => &[
                SessionStatus::WaitingInput,
                SessionStatus::Completed,
                SessionStatus::Error,
                SessionStatus::Paused,
            ],
            SessionStatus::WaitingInput => &[SessionStatus::Running, SessionStatus::Paused],
            SessionStatus::Completed => &[SessionStatus::Archived],
            SessionStatus::Error => &[SessionStatus::Running, SessionStatus::Paused, SessionStatus::Archived],
            SessionStatus::Paused => &[SessionStatus::Running, SessionStatus::Archived],
            SessionStatus::Archived => &[],
        }
    }

    pub fn can_transition_to(&self, target: &SessionStatus) -> bool {
        self.valid_transitions().contains(target)
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, SessionStatus::Archived)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            SessionStatus::Running => "running",
            SessionStatus::WaitingInput => "waiting_input",
            SessionStatus::Completed => "completed",
            SessionStatus::Error => "error",
            SessionStatus::Paused => "paused",
            SessionStatus::Archived => "archived",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "running" => Some(SessionStatus::Running),
            "waiting_input" => Some(SessionStatus::WaitingInput),
            "completed" => Some(SessionStatus::Completed),
            "error" => Some(SessionStatus::Error),
            "paused" => Some(SessionStatus::Paused),
            "archived" => Some(SessionStatus::Archived),
            _ => None,
        }
    }
}

/// Interaction mode — PTY terminal or structured JSON chat.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InteractionMode {
    Terminal,
    Structured,
}

impl InteractionMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            InteractionMode::Terminal => "terminal",
            InteractionMode::Structured => "structured",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "terminal" => Some(InteractionMode::Terminal),
            "structured" => Some(InteractionMode::Structured),
            _ => None,
        }
    }
}

/// Work context — binds a session to a specific development task.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(default)]
    pub issue_refs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pr_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_dir: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
}

/// Partial context patch for PATCH /sessions（局部上下文补丁）.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct WorkContextPatch {
    #[serde(default)]
    pub git_branch: Option<String>,
    #[serde(default)]
    pub worktree_path: Option<String>,
    #[serde(default)]
    pub issue_refs: Option<Vec<String>>,
    #[serde(default)]
    pub pr_ref: Option<String>,
    #[serde(default)]
    pub work_dir: Option<String>,
    #[serde(default)]
    pub labels: Option<Vec<String>>,
}

impl WorkContext {
    pub fn merge_patch(&self, patch: WorkContextPatch) -> Self {
        Self {
            git_branch: patch.git_branch.or_else(|| self.git_branch.clone()),
            worktree_path: patch
                .worktree_path
                .or_else(|| self.worktree_path.clone()),
            issue_refs: patch
                .issue_refs
                .unwrap_or_else(|| self.issue_refs.clone()),
            pr_ref: patch.pr_ref.or_else(|| self.pr_ref.clone()),
            work_dir: patch.work_dir.or_else(|| self.work_dir.clone()),
            labels: patch.labels.unwrap_or_else(|| self.labels.clone()),
        }
    }
}

/// A unified Agent Session in ExoMind.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub id: String,
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_host_id: Option<String>,
    pub role: String,
    pub summary: String,
    pub status: SessionStatus,
    pub interaction_mode: InteractionMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pty_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner_session_id: Option<String>,
    pub context: WorkContext,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    pub created_at: String,
    pub last_active_at: String,
    pub turn_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_output_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    /// Quick actions available when status == WaitingInput
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub quick_actions: Vec<QuickAction>,
}

/// Quick action type — what kind of quick action this is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuickActionType {
    /// A button with a predefined response
    Button,
    /// Free-text input field
    TextInput,
    /// Confirm/reject binary choice
    Confirm,
}

/// A quick action offered when a session is in WaitingInput state.
/// For structured mode, the agent defines these explicitly.
/// For terminal mode, a default "手动标记" action is provided.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuickAction {
    pub id: String,
    pub label: String,
    pub action_type: QuickActionType,
    /// Optional predefined payload (for Button type)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<String>,
    /// Optional description/hint
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Response to a quick action from the user.
#[derive(Debug, Clone, Deserialize)]
pub struct QuickActionResponse {
    pub action_id: String,
    /// User-provided value (for TextInput) or "true"/"false" (for Confirm)
    #[serde(default)]
    pub value: Option<String>,
}

/// Participant identity — who sent a message (User or Agent).
/// Unified model for cross-session communication.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Participant {
    User,
    Agent { session_id: String },
}

/// A cross-session message sent between sessions or from user to session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMessage {
    pub id: String,
    pub from: Participant,
    pub to_session_id: String,
    pub content: String,
    pub created_at: String,
    /// Optional reference to a parent message (for threading)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<String>,
}

/// Input for sending a cross-session message.
#[derive(Debug, Clone, Deserialize)]
pub struct SendMessageInput {
    pub content: String,
    /// Sender identity — defaults to User if omitted
    #[serde(default)]
    pub from: Option<Participant>,
    #[serde(default)]
    pub reply_to: Option<String>,
}

/// Input for creating a new session.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateSessionInput {
    #[serde(default)]
    pub id: Option<String>,
    pub agent_kind: String,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub source_host_id: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub context: Option<WorkContext>,
    #[serde(default)]
    pub interaction: Option<InteractionMode>,
    #[serde(default)]
    pub pty_id: Option<String>,
    #[serde(default)]
    pub inner_session_id: Option<String>,
    #[serde(default)]
    pub parent_session_id: Option<String>,
}

/// Input for updating an existing session.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct UpdateSessionInput {
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub source_host_id: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub status: Option<SessionStatus>,
    #[serde(default)]
    pub context: Option<WorkContextPatch>,
    #[serde(default)]
    pub last_output_preview: Option<String>,
    #[serde(default)]
    pub error_message: Option<String>,
    #[serde(default)]
    pub inner_session_id: Option<String>,
    /// Update the quick actions offered during WaitingInput
    #[serde(default)]
    pub quick_actions: Option<Vec<QuickAction>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn running_can_transition_to_waiting_and_completed() {
        let s = SessionStatus::Running;
        assert!(s.can_transition_to(&SessionStatus::WaitingInput));
        assert!(s.can_transition_to(&SessionStatus::Completed));
        assert!(s.can_transition_to(&SessionStatus::Error));
        assert!(s.can_transition_to(&SessionStatus::Paused));
        assert!(!s.can_transition_to(&SessionStatus::Archived));
    }

    #[test]
    fn waiting_input_can_return_to_running() {
        let s = SessionStatus::WaitingInput;
        assert!(s.can_transition_to(&SessionStatus::Running));
        assert!(s.can_transition_to(&SessionStatus::Paused));
        assert!(!s.can_transition_to(&SessionStatus::Completed));
    }

    #[test]
    fn completed_can_only_archive() {
        let s = SessionStatus::Completed;
        assert!(s.can_transition_to(&SessionStatus::Archived));
        assert!(!s.can_transition_to(&SessionStatus::Running));
    }

    #[test]
    fn archived_is_terminal() {
        assert!(SessionStatus::Archived.is_terminal());
        assert!(SessionStatus::Archived.valid_transitions().is_empty());
    }

    #[test]
    fn error_can_recover_or_archive() {
        let s = SessionStatus::Error;
        assert!(s.can_transition_to(&SessionStatus::Running));
        assert!(s.can_transition_to(&SessionStatus::Paused));
        assert!(s.can_transition_to(&SessionStatus::Archived));
    }

    #[test]
    fn serde_roundtrip() {
        let session = AgentSession {
            id: "test-1".to_string(),
            agent_kind: "claude".to_string(),
            agent_id: Some("claude".to_string()),
            source_host_id: Some("desktop-host".to_string()),
            role: "任务思考".to_string(),
            summary: "分析 #511".to_string(),
            status: SessionStatus::Running,
            interaction_mode: InteractionMode::Terminal,
            pty_id: Some("pty-1".to_string()),
            inner_session_id: None,
            context: WorkContext {
                git_branch: Some("dev".to_string()),
                issue_refs: vec!["#511".to_string()],
                ..Default::default()
            },
            parent_session_id: None,
            created_at: "2026-03-14T00:00:00Z".to_string(),
            last_active_at: "2026-03-14T00:05:00Z".to_string(),
            turn_count: 5,
            last_output_preview: Some("建议将 user.input 拆为三层".to_string()),
            error_message: None,
            quick_actions: vec![],
        };
        let json = serde_json::to_string(&session).unwrap();
        assert!(json.contains("\"running\""));
        assert!(json.contains("\"terminal\""));
        let back: AgentSession = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "test-1");
        assert_eq!(back.agent_kind, "claude");
        assert_eq!(back.agent_id.as_deref(), Some("claude"));
        assert_eq!(back.source_host_id.as_deref(), Some("desktop-host"));
        assert_eq!(back.context.git_branch.as_deref(), Some("dev"));
    }

    #[test]
    fn status_roundtrip() {
        let statuses = vec![
            SessionStatus::Running,
            SessionStatus::WaitingInput,
            SessionStatus::Completed,
            SessionStatus::Error,
            SessionStatus::Paused,
            SessionStatus::Archived,
        ];
        for status in &statuses {
            let s = status.as_str();
            let parsed = SessionStatus::from_str(s).expect("should parse");
            assert_eq!(&parsed, status);
        }
    }

    #[test]
    fn participant_serde_matches_ts_contract() {
        let user = serde_json::to_value(&Participant::User).unwrap();
        assert_eq!(user, serde_json::json!({ "type": "user" }));

        let agent = serde_json::to_value(&Participant::Agent {
            session_id: "sid-123".to_string(),
        })
        .unwrap();
        assert_eq!(
            agent,
            serde_json::json!({
                "type": "agent",
                "session_id": "sid-123",
            })
        );

        let roundtrip: Participant = serde_json::from_value(serde_json::json!({
            "type": "agent",
            "session_id": "sid-123",
        }))
        .unwrap();
        assert_eq!(
            roundtrip,
            Participant::Agent {
                session_id: "sid-123".to_string(),
            }
        );
    }

    #[test]
    fn work_context_patch_merges_without_dropping_existing_fields() {
        let original = WorkContext {
            git_branch: Some("dev".to_string()),
            worktree_path: Some("D:/project/exomind-wt-yyxw".to_string()),
            issue_refs: vec!["#511".to_string()],
            pr_ref: Some("523".to_string()),
            work_dir: Some("D:/project/exomind-wt-yyxw".to_string()),
            labels: vec!["runtime".to_string(), "review".to_string()],
        };

        let merged = original.merge_patch(WorkContextPatch {
            issue_refs: Some(vec!["#523".to_string()]),
            ..Default::default()
        });

        assert_eq!(merged.git_branch.as_deref(), Some("dev"));
        assert_eq!(merged.issue_refs, vec!["#523".to_string()]);
        assert_eq!(merged.pr_ref.as_deref(), Some("523"));
        assert_eq!(
            merged.labels,
            vec!["runtime".to_string(), "review".to_string()]
        );
    }
}
