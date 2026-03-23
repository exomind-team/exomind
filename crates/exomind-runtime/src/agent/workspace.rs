use std::fs;
use std::io::{self, BufRead, BufWriter, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Default maximum knowledge directory size in bytes (1 MB).
const DEFAULT_MAX_KNOWLEDGE_BYTES: usize = 1_048_576;

// ---------------------------------------------------------------------------
// ActionEntry — single append-only action record
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionEntry {
    pub timestamp: String,
    pub tick: u64,
    #[serde(alias = "action_type")]
    pub action_type: String,
    pub description: String,
    #[serde(alias = "energy_before")]
    pub energy_before: u64,
    #[serde(alias = "energy_after")]
    pub energy_after: u64,
}

// ---------------------------------------------------------------------------
// ActionLog — append-only JSONL log
// ---------------------------------------------------------------------------

pub struct ActionLog {
    path: PathBuf,
}

impl ActionLog {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Append a single entry as one JSON line.
    pub fn append(&self, entry: &ActionEntry) -> io::Result<()> {
        let file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        let mut writer = BufWriter::new(file);
        let line = serde_json::to_string(entry)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        writeln!(writer, "{line}")?;
        writer.flush()
    }

    /// Read all entries from the log file.
    pub fn read_all(&self) -> io::Result<Vec<ActionEntry>> {
        let content = match fs::read_to_string(&self.path) {
            Ok(c) => c,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
        let mut entries = Vec::new();
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let entry: ActionEntry = serde_json::from_str(trimmed)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
            entries.push(entry);
        }
        Ok(entries)
    }

    /// Count of entries (lines) in the log.
    pub fn count(&self) -> io::Result<u64> {
        let file = match fs::File::open(&self.path) {
            Ok(f) => f,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(e),
        };
        let reader = io::BufReader::new(file);
        let count = reader
            .lines()
            .filter_map(|l| l.ok())
            .filter(|l| !l.trim().is_empty())
            .count();
        Ok(count as u64)
    }
}

// ---------------------------------------------------------------------------
// AgentWorkspace — the agent's physical body (directory structure)
// ---------------------------------------------------------------------------

/// Agent workspace directory layout:
/// ```text
/// {root}/
///   bootstrap/
///     SOUL.md          — immutable DNA / identity
///   knowledge/         — mutable long-term memory
///   actions.jsonl      — append-only action log
///   agent.state.json   — serialized cognitive state
/// ```
pub struct AgentWorkspace {
    root: PathBuf,
    knowledge_dir: PathBuf,
    max_knowledge_bytes: usize,
    action_log: ActionLog,
}

impl AgentWorkspace {
    /// Initialise workspace directory structure. Creates directories and
    /// empty files if they do not already exist.
    pub fn init(agent_id: &str, base_dir: &Path) -> io::Result<Self> {
        let root = base_dir.join("agents").join(agent_id);
        let bootstrap_dir = root.join("bootstrap");
        let knowledge_dir = root.join("knowledge");
        let actions_path = root.join("actions.jsonl");
        let state_path = root.join("agent.state.json");

        fs::create_dir_all(&bootstrap_dir)?;
        fs::create_dir_all(&knowledge_dir)?;

        // Touch files if they don't exist.
        if !actions_path.exists() {
            fs::File::create(&actions_path)?;
        }
        if !state_path.exists() {
            fs::write(&state_path, "{}")?;
        }

        Ok(Self {
            root,
            knowledge_dir,
            max_knowledge_bytes: DEFAULT_MAX_KNOWLEDGE_BYTES,
            action_log: ActionLog::new(actions_path),
        })
    }

    // -- SOUL (immutable identity) ------------------------------------------

    /// Read SOUL.md content (the agent's DNA).
    pub fn load_soul(&self) -> io::Result<String> {
        fs::read_to_string(self.root.join("bootstrap").join("SOUL.md"))
    }

    /// Write SOUL.md only during first initialisation. Returns `Ok(false)` if
    /// the file already exists (no overwrite).
    pub fn write_default_soul(&self, content: &str) -> io::Result<bool> {
        let path = self.root.join("bootstrap").join("SOUL.md");
        if path.exists() {
            return Ok(false);
        }
        fs::write(&path, content)?;
        Ok(true)
    }

    // -- Knowledge CRUD -----------------------------------------------------

    /// Validate a knowledge filename — reject path traversal attempts.
    fn validate_filename(filename: &str) -> io::Result<()> {
        if filename.is_empty()
            || filename.contains("..")
            || filename.contains('/')
            || filename.contains('\\')
            || filename.starts_with('.')
            || Path::new(filename).is_absolute()
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("invalid knowledge filename: {filename}"),
            ));
        }
        Ok(())
    }

    pub fn read_knowledge(&self, filename: &str) -> io::Result<String> {
        Self::validate_filename(filename)?;
        fs::read_to_string(self.knowledge_dir.join(filename))
    }

    pub fn write_knowledge(&self, filename: &str, content: &str) -> io::Result<()> {
        Self::validate_filename(filename)?;

        // Check quota: current usage minus existing file size plus new content.
        let current_usage = self.knowledge_usage_bytes()?;
        let existing_size = match fs::metadata(self.knowledge_dir.join(filename)) {
            Ok(m) => m.len() as usize,
            Err(e) if e.kind() == io::ErrorKind::NotFound => 0,
            Err(e) => return Err(e),
        };
        let new_total = current_usage - existing_size + content.len();
        if new_total > self.max_knowledge_bytes {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                format!(
                    "knowledge quota exceeded: {new_total} > {} bytes",
                    self.max_knowledge_bytes
                ),
            ));
        }

        fs::write(self.knowledge_dir.join(filename), content)
    }

    pub fn delete_knowledge(&self, filename: &str) -> io::Result<()> {
        Self::validate_filename(filename)?;
        fs::remove_file(self.knowledge_dir.join(filename))
    }

    pub fn list_knowledge(&self) -> io::Result<Vec<String>> {
        let mut names = Vec::new();
        for entry in fs::read_dir(&self.knowledge_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                if let Some(name) = entry.file_name().to_str() {
                    names.push(name.to_string());
                }
            }
        }
        names.sort();
        Ok(names)
    }

    /// Total bytes used in the knowledge directory.
    pub fn knowledge_usage_bytes(&self) -> io::Result<usize> {
        let mut total: usize = 0;
        for entry in fs::read_dir(&self.knowledge_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                total += entry.metadata()?.len() as usize;
            }
        }
        Ok(total)
    }

    /// Knowledge usage ratio (0.0 – 1.0).
    pub fn knowledge_usage_ratio(&self) -> io::Result<f32> {
        if self.max_knowledge_bytes == 0 {
            return Ok(0.0);
        }
        let used = self.knowledge_usage_bytes()? as f32;
        Ok(used / self.max_knowledge_bytes as f32)
    }

    // -- Action log ---------------------------------------------------------

    pub fn action_log(&self) -> &ActionLog {
        &self.action_log
    }

    // -- Agent state persistence --------------------------------------------

    pub fn load_state(&self) -> io::Result<serde_json::Value> {
        let content = fs::read_to_string(self.root.join("agent.state.json"))?;
        serde_json::from_str(&content).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }

    pub fn save_state(&self, state: &serde_json::Value) -> io::Result<()> {
        let json = serde_json::to_string_pretty(state)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        fs::write(self.root.join("agent.state.json"), json)
    }

    // -- Accessors ----------------------------------------------------------

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn max_knowledge_bytes(&self) -> usize {
        self.max_knowledge_bytes
    }

    pub fn knowledge_dir(&self) -> &Path {
        &self.knowledge_dir
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_workspace(name: &str) -> (tempfile::TempDir, AgentWorkspace) {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let ws = AgentWorkspace::init(name, tmp.path()).expect("init workspace");
        (tmp, ws)
    }

    #[test]
    fn init_creates_directory_structure() {
        let (_tmp, ws) = temp_workspace("alpha");
        assert!(ws.root().join("bootstrap").is_dir());
        assert!(ws.root().join("knowledge").is_dir());
        assert!(ws.root().join("actions.jsonl").is_file());
        assert!(ws.root().join("agent.state.json").is_file());
    }

    #[test]
    fn soul_write_and_read() {
        let (_tmp, ws) = temp_workspace("alpha");
        let content = "# I am Alpha\nHello world.";
        assert!(ws.write_default_soul(content).unwrap());
        assert_eq!(ws.load_soul().unwrap(), content);

        // Second write should be a no-op.
        assert!(!ws.write_default_soul("overwrite attempt").unwrap());
        assert_eq!(ws.load_soul().unwrap(), content);
    }

    #[test]
    fn knowledge_crud() {
        let (_tmp, ws) = temp_workspace("alpha");

        ws.write_knowledge("diary.md", "Day 1: I exist.").unwrap();
        assert_eq!(ws.read_knowledge("diary.md").unwrap(), "Day 1: I exist.");
        assert_eq!(ws.list_knowledge().unwrap(), vec!["diary.md"]);

        ws.write_knowledge("diary.md", "Day 1 updated.").unwrap();
        assert_eq!(ws.read_knowledge("diary.md").unwrap(), "Day 1 updated.");

        ws.delete_knowledge("diary.md").unwrap();
        assert!(ws.list_knowledge().unwrap().is_empty());
    }

    #[test]
    fn knowledge_path_traversal_rejected() {
        let (_tmp, ws) = temp_workspace("alpha");

        assert!(ws.write_knowledge("../evil.txt", "hack").is_err());
        assert!(ws.write_knowledge("sub/file.txt", "hack").is_err());
        assert!(ws.write_knowledge(".hidden", "hack").is_err());
        assert!(ws.read_knowledge("..\\passwd").is_err());
    }

    #[test]
    fn knowledge_quota_enforced() {
        let (_tmp, ws) = temp_workspace("alpha");

        // Write content that fills most of quota.
        let big = "x".repeat(ws.max_knowledge_bytes() - 100);
        ws.write_knowledge("big.txt", &big).unwrap();

        // This should succeed (exactly at limit).
        ws.write_knowledge("small.txt", &"y".repeat(100)).unwrap();

        // This should fail (over quota).
        let result = ws.write_knowledge("extra.txt", "z");
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("quota exceeded"), "got: {err_msg}");
    }

    #[test]
    fn knowledge_usage_ratio() {
        let (_tmp, ws) = temp_workspace("alpha");
        let ratio = ws.knowledge_usage_ratio().unwrap();
        assert!((ratio - 0.0).abs() < f32::EPSILON);

        ws.write_knowledge("file.txt", &"a".repeat(524_288))
            .unwrap();
        let ratio = ws.knowledge_usage_ratio().unwrap();
        assert!((ratio - 0.5).abs() < 0.01);
    }

    #[test]
    fn action_log_append_and_read() {
        let (_tmp, ws) = temp_workspace("alpha");
        let log = ws.action_log();

        assert_eq!(log.count().unwrap(), 0);
        assert!(log.read_all().unwrap().is_empty());

        let entry = ActionEntry {
            timestamp: "2026-03-09T00:00:00Z".to_string(),
            tick: 1,
            action_type: "think".to_string(),
            description: "First thought.".to_string(),
            energy_before: 100,
            energy_after: 95,
        };
        log.append(&entry).unwrap();

        let entry2 = ActionEntry {
            timestamp: "2026-03-09T00:01:00Z".to_string(),
            tick: 2,
            action_type: "signal".to_string(),
            description: "Sent a pulse.".to_string(),
            energy_before: 95,
            energy_after: 90,
        };
        log.append(&entry2).unwrap();

        assert_eq!(log.count().unwrap(), 2);

        let all = log.read_all().unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].tick, 1);
        assert_eq!(all[1].tick, 2);
        assert_eq!(all[0].action_type, "think");
    }

    #[test]
    fn state_save_and_load() {
        let (_tmp, ws) = temp_workspace("alpha");

        let state = serde_json::json!({
            "strategy": "exploring",
            "tick_count": 42,
        });
        ws.save_state(&state).unwrap();

        let loaded = ws.load_state().unwrap();
        assert_eq!(loaded["strategy"], "exploring");
        assert_eq!(loaded["tick_count"], 42);
    }

    #[test]
    fn init_is_idempotent() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let ws1 = AgentWorkspace::init("beta", tmp.path()).unwrap();
        ws1.write_default_soul("Beta soul").unwrap();
        ws1.write_knowledge("note.md", "important").unwrap();

        // Re-init should not destroy existing data.
        let ws2 = AgentWorkspace::init("beta", tmp.path()).unwrap();
        assert_eq!(ws2.load_soul().unwrap(), "Beta soul");
        assert_eq!(ws2.read_knowledge("note.md").unwrap(), "important");
    }
}
