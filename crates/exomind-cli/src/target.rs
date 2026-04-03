use crate::state::CliState;

pub const DEFAULT_CANDIDATE_PORTS: [u16; 3] = [9124, 1950, 1949];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetResolution {
    pub target: String,
    pub source: TargetResolutionSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetResolutionSource {
    Explicit,
    SavedDefault,
    Probed,
}

pub fn resolve_target<F>(
    explicit_target: Option<&str>,
    state: &CliState,
    candidate_ports: &[u16],
    mut probe: F,
) -> Option<TargetResolution>
where
    F: FnMut(&str) -> bool,
{
    if let Some(target) = normalize_target(explicit_target) {
        return Some(TargetResolution {
            target,
            source: TargetResolutionSource::Explicit,
        });
    }

    if let Some(target) = normalize_target(state.default_target.as_deref()) {
        if probe(&target) {
            return Some(TargetResolution {
                target,
                source: TargetResolutionSource::SavedDefault,
            });
        }
    }

    for port in candidate_ports {
        let target = loopback_target(*port);
        if probe(&target) {
            return Some(TargetResolution {
                target,
                source: TargetResolutionSource::Probed,
            });
        }
    }

    None
}

pub fn loopback_target(port: u16) -> String {
    format!("127.0.0.1:{port}")
}

fn normalize_target(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}
