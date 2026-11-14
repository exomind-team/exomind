//! Private desktop presentation relay. Main remains the sole journal writer.
//! No overlay command calls Core mutation APIs or exposes a native Session.
use super::{trusted_window, Failure, NativeState};
use exomind_core::ProfileId;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashSet, VecDeque},
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

const LABEL: &str = "beta-focus-overlay";
const PATH: &str = "/beta-focus-overlay.html";
const MAX_REQUESTS: usize = 16;
const MAX_REQUEST_IDS: usize = 16_384;
// The relay carries current text/controls, never original bytes or histories.
// Larger metadata stays in Main; do not accumulate 64 full 8 MiB journals.
const MAX_BODY_BYTES: usize = 1024 * 1024;
const OWNER_HEARTBEAT: Duration = Duration::from_secs(5);
fn denied() -> Failure {
    Failure {
        code: "forbidden",
        message: "此窗口无权使用浮窗桥",
    }
}
fn stale() -> Failure {
    Failure {
        code: "overlay_scope_changed",
        message: "主窗口档案或草稿所有者已变化，请重新读取",
    }
}
fn unavailable() -> Failure {
    Failure {
        code: "overlay_not_ready",
        message: "主窗口尚未就绪，浮窗暂不可操作",
    }
}
fn conflict() -> Failure {
    Failure {
        code: "overlay_request_conflict",
        message: "同一浮窗请求不能更改内容或顺序",
    }
}
fn invalid() -> Failure {
    Failure {
        code: "invalid_request",
        message: "浮窗请求内容无效",
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct Binding {
    device_id: Uuid,
    runtime_id: Uuid,
    profile_id: ProfileId,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct Scope {
    device_id: Uuid,
    runtime_id: Uuid,
    profile_id: ProfileId,
    ui_owner_generation: Uuid,
}
impl Scope {
    fn binding(&self) -> Binding {
        Binding {
            device_id: self.device_id,
            runtime_id: self.runtime_id,
            profile_id: self.profile_id,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Action {
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
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct Request {
    request_id: Uuid,
    seq: u64,
    overlay_generation: Uuid,
    scope: Scope,
    expected_revision: String,
    action: Action,
}
#[derive(Clone, Serialize)]
pub(super) struct Ticket {
    ticket_id: Uuid,
    request: Request,
}
struct Entry {
    ticket: Ticket,
    response: Option<Value>,
}
struct Owner {
    scope: Scope,
    view: Option<Value>,
    published: Instant,
}
pub(super) struct Broker {
    owner: Option<Owner>,
    overlay_generation: Uuid,
    seq: u64,
    entries: VecDeque<Entry>,
    seen_ids: HashSet<Uuid>,
    position: Option<(i32, i32)>,
}
impl Default for Broker {
    fn default() -> Self {
        Self {
            owner: None,
            overlay_generation: Uuid::new_v4(),
            seq: 0,
            entries: VecDeque::new(),
            seen_ids: HashSet::new(),
            position: None,
        }
    }
}
impl Broker {
    fn register(&mut self, binding: Binding) -> Scope {
        let scope = Scope {
            device_id: binding.device_id,
            runtime_id: binding.runtime_id,
            profile_id: binding.profile_id,
            ui_owner_generation: Uuid::new_v4(),
        };
        self.owner = Some(Owner {
            scope: scope.clone(),
            view: None,
            published: Instant::now(),
        });
        self.entries.clear();
        self.seen_ids.clear();
        self.seq = 0;
        scope
    }
    fn owner(&self, scope: &Scope) -> Result<&Owner, Failure> {
        self.owner
            .as_ref()
            .filter(|owner| owner.scope == *scope)
            .ok_or_else(stale)
    }
    fn publish(&mut self, scope: &Scope, view: Value) -> Result<(), Failure> {
        self.owner(scope)?;
        if serde_json::to_vec(&view).map_err(|_| invalid())?.len() > MAX_BODY_BYTES
            || view.get("scope") != Some(&serde_json::to_value(scope).map_err(|_| invalid())?)
        {
            return Err(invalid());
        }
        let owner = self.owner.as_mut().ok_or_else(stale)?;
        owner.view = Some(view);
        owner.published = Instant::now();
        Ok(())
    }
    fn ready(&self) -> bool {
        self.owner.as_ref().is_some_and(|owner| {
            owner.view.is_some() && owner.published.elapsed() <= OWNER_HEARTBEAT
        })
    }
    fn attach(&mut self) -> Uuid {
        self.overlay_generation = Uuid::new_v4();
        self.seq = 0;
        self.entries.clear();
        self.seen_ids.clear();
        self.overlay_generation
    }
    pub(super) fn document_started(&mut self, label: &str) {
        if label == "main" {
            self.owner = None;
            self.entries.clear();
            self.seen_ids.clear();
            self.seq = 0;
        } else if label == LABEL {
            self.attach();
        }
    }
    fn submit(&mut self, request: Request) -> Result<(), Failure> {
        self.owner(&request.scope)?;
        if request.overlay_generation != self.overlay_generation {
            return Err(stale());
        }
        if !self.ready() {
            return Err(unavailable());
        }
        if request.request_id.is_nil()
            || request.seq == 0
            || request.seq > 9_007_199_254_740_991
            || request.expected_revision.len() != 64
            || !request
                .expected_revision
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(invalid());
        }
        if serde_json::to_vec(&request).map_err(|_| invalid())?.len() > MAX_BODY_BYTES {
            return Err(invalid());
        }
        if let Some(entry) = self.entries.iter().find(|entry| {
            entry.ticket.request.request_id == request.request_id
                || entry.ticket.request.seq == request.seq
        }) {
            return if entry.ticket.request == request {
                Ok(())
            } else {
                Err(conflict())
            };
        }
        if request.seq <= self.seq {
            return Err(Failure {
                code: "overlay_request_expired",
                message: "此旧请求已不在浮窗回执缓存中，未重新执行；请回主窗查证",
            });
        }
        if self.seen_ids.contains(&request.request_id) {
            return Err(conflict());
        }
        if self.seen_ids.len() >= MAX_REQUEST_IDS {
            return Err(Failure {
                code: "overlay_session_full",
                message: "浮窗会话请求已满，请保留输入并回主窗查证后重新打开",
            });
        }
        if request.seq != self.seq + 1 {
            return Err(conflict());
        }
        while self.entries.len() >= MAX_REQUESTS {
            if self
                .entries
                .front()
                .is_some_and(|entry| entry.response.is_some())
            {
                self.entries.pop_front();
            } else {
                return Err(Failure {
                    code: "overlay_busy",
                    message: "浮窗操作尚未确认，请先查证",
                });
            }
        }
        self.seq = request.seq;
        self.seen_ids.insert(request.request_id);
        self.entries.push_back(Entry {
            ticket: Ticket {
                ticket_id: Uuid::new_v4(),
                request,
            },
            response: None,
        });
        Ok(())
    }
    fn take(&self, scope: &Scope) -> Result<Vec<Ticket>, Failure> {
        self.owner(scope)?;
        Ok(self
            .entries
            .iter()
            .filter(|entry| entry.response.is_none())
            .map(|entry| entry.ticket.clone())
            .collect())
    }
    fn respond(&mut self, scope: &Scope, ticket_id: Uuid, response: Value) -> Result<(), Failure> {
        self.owner(scope)?;
        if serde_json::to_vec(&response).map_err(|_| invalid())?.len() > MAX_BODY_BYTES {
            return Err(invalid());
        }
        let entry = self
            .entries
            .iter_mut()
            .find(|entry| entry.ticket.ticket_id == ticket_id)
            .ok_or_else(stale)?;
        if let Some(prior) = &entry.response {
            return if prior == &response {
                Ok(())
            } else {
                Err(conflict())
            };
        }
        entry.response = Some(response);
        Ok(())
    }
    fn revoke(&mut self, scope: &Scope) {
        if self
            .owner
            .as_ref()
            .is_some_and(|owner| owner.scope == *scope)
        {
            self.owner = None;
            self.entries.clear();
        }
    }
}

fn overlay_url(url: &url::Url, origin: Option<&url::Origin>) -> bool {
    if url.path() != PATH
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return false;
    }
    if url.port().is_none()
        && matches!(
            (url.scheme(), url.host_str()),
            ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
        )
    {
        return true;
    }
    #[cfg(debug_assertions)]
    {
        origin.is_some_and(|origin| *origin == url.origin())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = origin;
        false
    }
}
fn trusted_overlay(window: &WebviewWindow, state: &NativeState) -> Result<(), Failure> {
    if overlay_caller(
        window.label(),
        &window.url().map_err(|_| denied())?,
        state.dev_origin.as_ref(),
    ) {
        Ok(())
    } else {
        Err(denied())
    }
}
fn overlay_caller(label: &str, url: &url::Url, origin: Option<&url::Origin>) -> bool {
    label == LABEL && overlay_url(url, origin)
}
fn check_binding(state: &NativeState, binding: &Binding) -> Result<(), Failure> {
    if state.closing.load(std::sync::atomic::Ordering::Acquire) {
        return Err(unavailable());
    }
    let status = state.host.status().map_err(Failure::from)?;
    if !status.running
        || status.runtime_id != binding.runtime_id
        || status.device_id.to_string() != binding.device_id.to_string()
    {
        return Err(stale());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum MainOperation {
    Register {
        binding: Binding,
    },
    Publish {
        scope: Scope,
        view: Value,
    },
    Take {
        scope: Scope,
    },
    Validate {
        scope: Scope,
        ticket_id: Uuid,
    },
    Respond {
        scope: Scope,
        ticket_id: Uuid,
        response: Value,
    },
    Revoke {
        scope: Scope,
    },
}
#[tauri::command]
pub(super) async fn beta_overlay_main(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    operation: MainOperation,
) -> Result<Value, Failure> {
    trusted_window(&window, state.inner())?;
    let binding = match &operation {
        MainOperation::Register { binding } => binding.clone(),
        MainOperation::Publish { scope, .. }
        | MainOperation::Take { scope }
        | MainOperation::Validate { scope, .. }
        | MainOperation::Respond { scope, .. }
        | MainOperation::Revoke { scope } => scope.binding(),
    };
    check_binding(state.inner(), &binding)?;
    // Only the already-trusted Main may establish a profile session. An
    // untrusted overlay payload must never mint sessions for arbitrary IDs.
    if matches!(&operation, MainOperation::Register { .. }) {
        state.human(binding.profile_id).map_err(Failure::from)?;
    }
    let mut broker = state.overlay.lock().map_err(|_| unavailable())?;
    match operation {
        MainOperation::Register { binding } => {
            serde_json::to_value(broker.register(binding)).map_err(|_| invalid())
        }
        MainOperation::Publish { scope, view } => {
            broker.publish(&scope, view)?;
            Ok(Value::Null)
        }
        MainOperation::Take { scope } => {
            serde_json::to_value(broker.take(&scope)?).map_err(|_| invalid())
        }
        MainOperation::Validate { scope, ticket_id } => {
            broker.owner(&scope)?;
            if !broker
                .entries
                .iter()
                .any(|entry| entry.ticket.ticket_id == ticket_id && entry.response.is_none())
            {
                return Err(stale());
            }
            Ok(Value::Null)
        }
        MainOperation::Respond {
            scope,
            ticket_id,
            response,
        } => {
            broker.respond(&scope, ticket_id, response)?;
            Ok(Value::Null)
        }
        MainOperation::Revoke { scope } => {
            broker.revoke(&scope);
            Ok(Value::Null)
        }
    }
}
#[tauri::command]
pub(super) async fn beta_overlay_attach(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
) -> Result<Uuid, Failure> {
    trusted_overlay(&window, state.inner())?;
    let generation = state.overlay.lock().map_err(|_| unavailable())?.attach();
    Ok(generation)
}
#[tauri::command]
pub(super) async fn beta_overlay_read(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
) -> Result<Value, Failure> {
    trusted_overlay(&window, state.inner())?;
    let broker = state.overlay.lock().map_err(|_| unavailable())?;
    if let Some(owner) = &broker.owner {
        check_binding(state.inner(), &owner.scope.binding())?;
    }
    Ok(
        serde_json::json!({"overlay_generation":broker.overlay_generation,"ready":broker.ready(),"view":if broker.ready(){broker.owner.as_ref().and_then(|owner|owner.view.as_ref())}else{None},"responses":broker.entries.iter().filter_map(|entry|entry.response.as_ref().map(|response|serde_json::json!({"request_id":entry.ticket.request.request_id,"response":response}))).collect::<Vec<_>>()}),
    )
}
#[tauri::command]
pub(super) async fn beta_overlay_request(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    request: Request,
) -> Result<(), Failure> {
    trusted_overlay(&window, state.inner())?;
    check_binding(state.inner(), &request.scope.binding())?;
    let result = state
        .overlay
        .lock()
        .map_err(|_| unavailable())?
        .submit(request);
    result
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum WindowOperation {
    Show,
    Hide,
    ReturnMain,
    Resize { width: u32, height: u32 },
    RememberPosition,
}
#[tauri::command]
pub(super) async fn beta_overlay_window(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    operation: WindowOperation,
) -> Result<(), Failure> {
    if matches!(operation, WindowOperation::Show) {
        trusted_window(&window, state.inner())?;
    } else {
        trusted_overlay(&window, state.inner())?;
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, operation);
        return Err(Failure {
            code: "overlay_unsupported",
            message: "当前平台尚未提供独立桌面浮窗",
        });
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        match operation {
            WindowOperation::Show => {
                ensure_window(&app)?;
                let overlay = app.get_webview_window(LABEL).ok_or_else(unavailable)?;
                let saved = state.overlay.lock().map_err(|_| unavailable())?.position;
                position_window(&app, &overlay, saved)?;
                overlay.show().map_err(|_| unavailable())?;
            }
            WindowOperation::Hide => window.hide().map_err(|_| unavailable())?,
            WindowOperation::ReturnMain => {
                let main = app.get_webview_window("main").ok_or_else(unavailable)?;
                main.show().map_err(|_| unavailable())?;
                let _ = main.unminimize();
                main.set_focus().map_err(|_| unavailable())?;
            }
            WindowOperation::Resize { width, height } => {
                // Alpha's measured mini/idle pills can be shorter than their
                // fallback window sizes. Keep those exact positive measures.
                if !(1..=1600).contains(&width) || !(1..=1600).contains(&height) {
                    return Err(invalid());
                }
                window
                    .set_size(tauri::LogicalSize::new(width, height))
                    .map_err(|_| unavailable())?;
            }
            WindowOperation::RememberPosition => {
                let point = window.outer_position().map_err(|_| unavailable())?;
                if point.x > -30000 || point.y > -30000 {
                    state.overlay.lock().map_err(|_| unavailable())?.position =
                        Some((point.x, point.y));
                }
            }
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn ensure_window(app: &AppHandle) -> Result<(), Failure> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let directory = crate::dev_instance_paths::resolve_overlay_webview_data_dir(LABEL)
        .map_err(|_| unavailable())?
        .unwrap_or(
            app.path()
                .app_data_dir()
                .map_err(|_| unavailable())?
                .join("beta-overlay-webview"),
        );
    std::fs::create_dir_all(&directory).map_err(|_| unavailable())?;
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        LABEL,
        tauri::WebviewUrl::App(PATH.trim_start_matches('/').into()),
    )
    .title("外心 · 专注")
    .inner_size(412.0, 490.0)
    .always_on_top(true)
    .decorations(false)
    .shadow(false)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false)
    .data_directory(directory);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);
    let window = builder.build().map_err(|_| unavailable())?;
    position_window(app, &window, None)
}
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn position_window(
    app: &AppHandle,
    window: &WebviewWindow,
    saved: Option<(i32, i32)>,
) -> Result<(), Failure> {
    let size = window.inner_size().map_err(|_| unavailable())?;
    if let Some((x, y)) = saved {
        if app
            .available_monitors()
            .map_err(|_| unavailable())?
            .iter()
            .any(|m| {
                let p = m.position();
                let s = m.size();
                i64::from(x) < i64::from(p.x) + i64::from(s.width)
                    && i64::from(x) + i64::from(size.width) > i64::from(p.x)
                    && i64::from(y) < i64::from(p.y) + i64::from(s.height)
                    && i64::from(y) + i64::from(size.height) > i64::from(p.y)
            })
        {
            return window
                .set_position(tauri::PhysicalPosition::new(x, y))
                .map_err(|_| unavailable());
        }
    }
    let monitor = app
        .get_webview_window("main")
        .and_then(|main| main.current_monitor().ok().flatten())
        .or(app.primary_monitor().map_err(|_| unavailable())?);
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let x =
            area.position.x + (area.size.width as i64 - i64::from(size.width) - 24).max(0) as i32;
        let y =
            area.position.y + (area.size.height as i64 - i64::from(size.height) - 24).max(0) as i32;
        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|_| unavailable())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn binding() -> Binding {
        Binding {
            device_id: Uuid::new_v4(),
            runtime_id: Uuid::new_v4(),
            profile_id: ProfileId::new(),
        }
    }
    fn ready() -> (Broker, Scope) {
        let mut broker = Broker::default();
        let scope = broker.register(binding());
        broker
            .publish(&scope, serde_json::json!({"scope":scope}))
            .unwrap();
        (broker, scope)
    }
    fn request(broker: &Broker, scope: &Scope) -> Request {
        Request {
            request_id: Uuid::new_v4(),
            seq: 1,
            overlay_generation: broker.overlay_generation,
            scope: scope.clone(),
            expected_revision: "a".repeat(64),
            action: Action::Pause {
                block_id: Uuid::new_v4(),
            },
        }
    }
    #[test]
    fn duplicate_reuses_ticket_and_changed_body_cannot_replace() {
        let (mut b, s) = ready();
        let r = request(&b, &s);
        b.submit(r.clone()).unwrap();
        let ticket = b.take(&s).unwrap()[0].ticket_id;
        b.submit(r.clone()).unwrap();
        assert_eq!(b.take(&s).unwrap().len(), 1);
        assert_eq!(b.take(&s).unwrap()[0].ticket_id, ticket);
        let mut changed = r;
        changed.action = Action::Refresh;
        assert_eq!(
            b.submit(changed).unwrap_err().code,
            "overlay_request_conflict"
        );
    }
    #[test]
    fn new_owner_rejects_old_scope_and_stale_revoke_does_not_kill_new_owner() {
        let (mut b, s) = ready();
        let r = request(&b, &s);
        let next = b.register(binding());
        assert_eq!(b.submit(r).unwrap_err().code, "overlay_scope_changed");
        b.revoke(&s);
        assert!(b.owner(&next).is_ok());
    }
    #[test]
    fn document_reload_revokes_old_requests_without_rewriting_journals() {
        let (mut b, s) = ready();
        let r = request(&b, &s);
        b.submit(r.clone()).unwrap();
        b.attach();
        assert!(b.take(&s).unwrap().is_empty());
        assert_eq!(b.submit(r).unwrap_err().code, "overlay_scope_changed");
    }
    #[test]
    fn precise_overlay_origin_path_is_required() {
        for raw in [
            "tauri://localhost/beta.html",
            "tauri://localhost/beta-focus-overlay.html?x=1",
            "tauri://localhost/beta-focus-overlay.html#x",
            "https://evil.test/beta-focus-overlay.html",
        ] {
            assert!(!overlay_url(&url::Url::parse(raw).unwrap(), None));
        }
        assert!(overlay_url(
            &url::Url::parse("tauri://localhost/beta-focus-overlay.html").unwrap(),
            None
        ));
    }
    #[test]
    fn no_owner_no_operation_and_completed_response_is_immutable() {
        let (mut b, s) = ready();
        let r = request(&b, &s);
        b.submit(r.clone()).unwrap();
        let t = b.take(&s).unwrap()[0].ticket_id;
        b.respond(&s, t, serde_json::json!({"ok":true})).unwrap();
        assert_eq!(
            b.respond(&s, t, serde_json::json!({"ok":false}))
                .unwrap_err()
                .code,
            "overlay_request_conflict"
        );
        b.revoke(&s);
        assert_eq!(b.submit(r).unwrap_err().code, "overlay_scope_changed");
    }
    #[test]
    fn main_reload_immediately_revokes_ready_instead_of_waiting_for_heartbeat() {
        let (mut b, s) = ready();
        let r = request(&b, &s);
        b.document_started("main");
        assert!(!b.ready());
        assert_eq!(b.submit(r).unwrap_err().code, "overlay_scope_changed");
    }
    #[test]
    fn heartbeat_expiry_never_authorizes_another_operation() {
        let (mut b, s) = ready();
        b.owner.as_mut().unwrap().published = Instant::now() - Duration::from_secs(6);
        assert!(!b.ready());
        let r = request(&b, &s);
        assert_eq!(b.submit(r).unwrap_err().code, "overlay_not_ready");
    }
    #[test]
    fn completed_cache_eviction_keeps_sequence_tombstone() {
        let (mut b, s) = ready();
        let first = request(&b, &s);
        for seq in 1..=17 {
            let mut r = request(&b, &s);
            r.seq = seq;
            if seq == 1 {
                r = first.clone();
            }
            b.submit(r).unwrap();
            let t = b.take(&s).unwrap()[0].ticket_id;
            b.respond(&s, t, Value::Null).unwrap();
        }
        assert_eq!(b.entries.len(), MAX_REQUESTS);
        assert_eq!(b.submit(first).unwrap_err().code, "overlay_request_expired");
    }
    #[test]
    fn correct_url_does_not_authorize_another_window_label() {
        let url = url::Url::parse("tauri://localhost/beta-focus-overlay.html").unwrap();
        assert!(!overlay_caller("main", &url, None));
        assert!(!overlay_caller("voice-overlay", &url, None));
        assert!(overlay_caller(LABEL, &url, None));
    }
}
