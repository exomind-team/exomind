use super::ProcessMeasurements;
use crate::diagnostics::{DiagnosticMetric, DiagnosticReason, MetricUnit};
use std::{fs, io};

pub(super) fn sample_process() -> ProcessMeasurements {
    ProcessMeasurements {
        pid: std::process::id(),
        cumulative_cpu_time: cumulative_cpu_time(),
        working_set_bytes: working_set_bytes(),
        private_bytes: DiagnosticMetric::unknown(MetricUnit::Bytes, DiagnosticReason::Unsupported),
    }
}

fn cumulative_cpu_time() -> DiagnosticMetric<u64> {
    let stat = match fs::read_to_string("/proc/self/stat") {
        Ok(stat) => stat,
        Err(error) => return DiagnosticMetric::unknown(MetricUnit::Nanoseconds, io_reason(&error)),
    };
    let Some(ticks) = process_cpu_ticks(&stat) else {
        return DiagnosticMetric::unknown(MetricUnit::Nanoseconds, DiagnosticReason::InvalidData);
    };
    // SAFETY: `_SC_CLK_TCK` is a valid sysconf selector and has no pointer arguments.
    let ticks_per_second = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if ticks_per_second <= 0 {
        return DiagnosticMetric::unknown(MetricUnit::Nanoseconds, DiagnosticReason::Unavailable);
    }
    let Some(nanoseconds) = (ticks as u128)
        .checked_mul(1_000_000_000)
        .map(|value| value / ticks_per_second as u128)
        .and_then(|value| u64::try_from(value).ok())
    else {
        return DiagnosticMetric::unknown(MetricUnit::Nanoseconds, DiagnosticReason::InvalidData);
    };
    DiagnosticMetric::available(nanoseconds, MetricUnit::Nanoseconds)
}

/// `/proc/self/stat` has a parenthesized comm field that may contain spaces
/// and `)`; CPU counters begin after its final delimiter.
fn process_cpu_ticks(stat: &str) -> Option<u64> {
    let (_, fields_after_comm) = stat.rsplit_once(')')?;
    let fields: Vec<&str> = fields_after_comm.split_whitespace().collect();
    let user_ticks = fields.get(11)?.parse::<u64>().ok()?;
    let system_ticks = fields.get(12)?.parse::<u64>().ok()?;
    user_ticks.checked_add(system_ticks)
}

fn working_set_bytes() -> DiagnosticMetric<u64> {
    let statm = match fs::read_to_string("/proc/self/statm") {
        Ok(statm) => statm,
        Err(error) => return DiagnosticMetric::unknown(MetricUnit::Bytes, io_reason(&error)),
    };
    let Some(resident_pages) = statm
        .split_whitespace()
        .nth(1)
        .and_then(|resident| resident.parse::<u64>().ok())
    else {
        return DiagnosticMetric::unknown(MetricUnit::Bytes, DiagnosticReason::InvalidData);
    };
    // SAFETY: `_SC_PAGESIZE` is a valid sysconf selector and has no pointer arguments.
    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if page_size <= 0 {
        return DiagnosticMetric::unknown(MetricUnit::Bytes, DiagnosticReason::Unavailable);
    }
    let Some(bytes) = resident_pages.checked_mul(page_size as u64) else {
        return DiagnosticMetric::unknown(MetricUnit::Bytes, DiagnosticReason::InvalidData);
    };
    DiagnosticMetric::available(bytes, MetricUnit::Bytes)
}

fn io_reason(error: &io::Error) -> DiagnosticReason {
    match error.kind() {
        io::ErrorKind::PermissionDenied => DiagnosticReason::PermissionDenied,
        io::ErrorKind::Unsupported => DiagnosticReason::Unsupported,
        _ => DiagnosticReason::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proc_stat_parser_handles_parentheses_and_sums_user_and_system_ticks() {
        let mut fields = vec!["R"; 13];
        fields[11] = "17";
        fields[12] = "23";
        let stat = format!("123 (worker ) with spaces) {}", fields.join(" "));

        assert_eq!(process_cpu_ticks(&stat), Some(40));
    }
}
