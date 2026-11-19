use super::{DIAGNOSTICS_SCHEMA_VERSION, DiagnosticMetric, DiagnosticReason, MetricUnit};
use serde::Serialize;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[cfg(any(target_os = "linux", target_os = "android"))]
#[path = "process/procfs.rs"]
mod procfs;
#[cfg(target_os = "windows")]
#[path = "process/windows.rs"]
mod windows;

/// Scope of the process values. This is the Native/Host process only; WebView,
/// GPU, other processes, and device power are outside this measurement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessScope {
    NativeHostProcess,
}

/// Runtime identity for one process collector lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessIdentity {
    pub pid: u32,
    pub collector_lifecycle: Uuid,
}

/// Cumulative CPU time and a rate derived from two samples.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessCpuDiagnostics {
    /// Cumulative user plus kernel CPU time for this process.
    #[serde(serialize_with = "super::serialize_nanosecond_metric")]
    pub cumulative_time: DiagnosticMetric<u64>,
    /// CPU cores used over `measurement_window`; 1.0 means one logical CPU
    /// fully occupied, and multi-threaded processes may exceed 1.0.
    pub usage_cores: DiagnosticMetric<f64>,
    /// Monotonic interval used for `usage_cores`.
    #[serde(serialize_with = "super::serialize_nanosecond_metric")]
    pub measurement_window: DiagnosticMetric<u64>,
}

/// Process memory values with their operating-system meanings kept explicit.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryDiagnostics {
    /// Resident pages on Linux/Android; working set on Windows.
    pub working_set_bytes: DiagnosticMetric<u64>,
    /// Private committed bytes on Windows. Unsupported elsewhere in this slice.
    pub private_bytes: DiagnosticMetric<u64>,
}

/// One on-demand process sample. The collector keeps only one CPU baseline.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessResourceSample {
    pub schema_version: u16,
    pub scope: ProcessScope,
    pub identity: ProcessIdentity,
    /// Wall timestamp for display; monotonic elapsed time is used for rates.
    pub sampled_at_unix_ms: Option<u64>,
    /// Monotonic nanoseconds since this collector was constructed.
    #[serde(serialize_with = "super::serialize_nanoseconds")]
    pub monotonic_elapsed_ns: u64,
    pub cpu: ProcessCpuDiagnostics,
    pub memory: ProcessMemoryDiagnostics,
}

/// Explicitly sampled current-process resources; it starts no timer or worker.
/// Keep one instance for a measurement window and call [`Self::sample`] only
/// when the Native caller requests a sample.
pub struct ProcessDiagnosticsCollector {
    lifecycle: Uuid,
    started_at: Instant,
    previous_cpu: Option<CpuCounter>,
}

impl ProcessDiagnosticsCollector {
    /// Starts a collector lifecycle without sampling or spawning background work.
    pub fn new() -> Self {
        Self {
            lifecycle: Uuid::new_v4(),
            started_at: Instant::now(),
            previous_cpu: None,
        }
    }

    /// Samples only this process. First samples and invalid deltas remain unknown.
    pub fn sample(&mut self) -> ProcessResourceSample {
        let measurements = sample_platform_process();
        let monotonic_elapsed_ns =
            self.started_at.elapsed().as_nanos().min(u64::MAX as u128) as u64;
        let sampled_at_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64);
        self.record_measurements(measurements, sampled_at_unix_ms, monotonic_elapsed_ns)
    }

    fn record_measurements(
        &mut self,
        measurements: ProcessMeasurements,
        sampled_at_unix_ms: Option<u64>,
        monotonic_elapsed_ns: u64,
    ) -> ProcessResourceSample {
        let identity = ProcessIdentity {
            pid: measurements.pid,
            collector_lifecycle: self.lifecycle,
        };
        let (usage_cores, measurement_window) =
            if let Some(cumulative_cpu_time_ns) = measurements.cumulative_cpu_time.value {
                let current = CpuCounter {
                    identity,
                    cumulative_cpu_time_ns,
                    monotonic_elapsed_ns,
                };
                let derived = derive_cpu_cores(self.previous_cpu, current);
                self.previous_cpu = Some(current);
                derived
            } else {
                let reason = measurements
                    .cumulative_cpu_time
                    .reason
                    .unwrap_or(DiagnosticReason::Unavailable);
                (
                    DiagnosticMetric::unknown(MetricUnit::CpuCores, reason),
                    DiagnosticMetric::unknown(MetricUnit::Nanoseconds, reason),
                )
            };

        ProcessResourceSample {
            schema_version: DIAGNOSTICS_SCHEMA_VERSION,
            scope: ProcessScope::NativeHostProcess,
            identity,
            sampled_at_unix_ms,
            monotonic_elapsed_ns,
            cpu: ProcessCpuDiagnostics {
                cumulative_time: measurements.cumulative_cpu_time,
                usage_cores,
                measurement_window,
            },
            memory: ProcessMemoryDiagnostics {
                working_set_bytes: measurements.working_set_bytes,
                private_bytes: measurements.private_bytes,
            },
        }
    }
}

impl Default for ProcessDiagnosticsCollector {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy)]
struct CpuCounter {
    identity: ProcessIdentity,
    cumulative_cpu_time_ns: u64,
    monotonic_elapsed_ns: u64,
}

struct ProcessMeasurements {
    pid: u32,
    cumulative_cpu_time: DiagnosticMetric<u64>,
    working_set_bytes: DiagnosticMetric<u64>,
    private_bytes: DiagnosticMetric<u64>,
}

fn derive_cpu_cores(
    previous: Option<CpuCounter>,
    current: CpuCounter,
) -> (DiagnosticMetric<f64>, DiagnosticMetric<u64>) {
    let Some(previous) = previous else {
        return unknown_cpu_delta(DiagnosticReason::InitialSample);
    };
    if previous.identity != current.identity {
        return unknown_cpu_delta(DiagnosticReason::IdentityChanged);
    }
    if current.monotonic_elapsed_ns < previous.monotonic_elapsed_ns {
        return unknown_cpu_delta(DiagnosticReason::ClockRegressed);
    }
    if current.monotonic_elapsed_ns == previous.monotonic_elapsed_ns {
        return unknown_cpu_delta(DiagnosticReason::ClockDidNotAdvance);
    }
    if current.cumulative_cpu_time_ns < previous.cumulative_cpu_time_ns {
        return unknown_cpu_delta(DiagnosticReason::CounterRegressed);
    }

    let window_ns = current.monotonic_elapsed_ns - previous.monotonic_elapsed_ns;
    let cpu_delta_ns = current.cumulative_cpu_time_ns - previous.cumulative_cpu_time_ns;
    (
        DiagnosticMetric::available(cpu_delta_ns as f64 / window_ns as f64, MetricUnit::CpuCores),
        DiagnosticMetric::available(window_ns, MetricUnit::Nanoseconds),
    )
}

fn unknown_cpu_delta(reason: DiagnosticReason) -> (DiagnosticMetric<f64>, DiagnosticMetric<u64>) {
    (
        DiagnosticMetric::unknown(MetricUnit::CpuCores, reason),
        DiagnosticMetric::unknown(MetricUnit::Nanoseconds, reason),
    )
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn sample_platform_process() -> ProcessMeasurements {
    procfs::sample_process()
}

#[cfg(target_os = "windows")]
fn sample_platform_process() -> ProcessMeasurements {
    windows::sample_process()
}

#[cfg(not(any(target_os = "linux", target_os = "android", target_os = "windows")))]
fn sample_platform_process() -> ProcessMeasurements {
    let unsupported =
        || DiagnosticMetric::unknown(MetricUnit::Nanoseconds, DiagnosticReason::Unsupported);
    ProcessMeasurements {
        pid: std::process::id(),
        cumulative_cpu_time: unsupported(),
        working_set_bytes: DiagnosticMetric::unknown(
            MetricUnit::Bytes,
            DiagnosticReason::Unsupported,
        ),
        private_bytes: DiagnosticMetric::unknown(MetricUnit::Bytes, DiagnosticReason::Unsupported),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::{DiagnosticMetric, DiagnosticReason, MetricAvailability, MetricUnit};
    use uuid::Uuid;

    fn counter(pid: u32, lifecycle: Uuid, cpu_ns: u64, monotonic_ns: u64) -> CpuCounter {
        CpuCounter {
            identity: ProcessIdentity {
                pid,
                collector_lifecycle: lifecycle,
            },
            cumulative_cpu_time_ns: cpu_ns,
            monotonic_elapsed_ns: monotonic_ns,
        }
    }

    #[test]
    fn first_cpu_sample_is_unknown_with_explicit_units() {
        let current = counter(41, Uuid::new_v4(), 80, 100);

        let (usage, window) = derive_cpu_cores(None, current);

        assert_eq!(usage.value, None);
        assert_eq!(usage.unit, MetricUnit::CpuCores);
        assert_eq!(usage.availability, MetricAvailability::Unknown);
        assert_eq!(usage.reason, Some(DiagnosticReason::InitialSample));
        assert_eq!(window.value, None);
        assert_eq!(window.unit, MetricUnit::Nanoseconds);
    }

    #[test]
    fn cpu_cores_come_from_cumulative_process_time_over_monotonic_window() {
        let lifecycle = Uuid::new_v4();
        let previous = counter(41, lifecycle, 200_000_000, 1_000_000_000);
        let current = counter(41, lifecycle, 600_000_000, 2_000_000_000);

        let (usage, window) = derive_cpu_cores(Some(previous), current);

        assert_eq!(usage.value, Some(0.4));
        assert_eq!(usage.unit, MetricUnit::CpuCores);
        assert_eq!(usage.availability, MetricAvailability::Available);
        assert_eq!(window.value, Some(1_000_000_000));
    }

    #[test]
    fn cpu_rate_is_unknown_when_pid_or_collector_lifecycle_changes() {
        let lifecycle = Uuid::new_v4();
        let previous = counter(41, lifecycle, 100, 100);
        let current = counter(42, lifecycle, 200, 200);

        let (usage, window) = derive_cpu_cores(Some(previous), current);

        assert_eq!(usage.value, None);
        assert_eq!(usage.reason, Some(DiagnosticReason::IdentityChanged));
        assert_eq!(window.value, None);

        let current = counter(41, Uuid::new_v4(), 200, 200);
        let (usage, _) = derive_cpu_cores(Some(previous), current);
        assert_eq!(usage.reason, Some(DiagnosticReason::IdentityChanged));
    }

    #[test]
    fn cpu_counter_and_monotonic_time_regressions_remain_unknown() {
        let lifecycle = Uuid::new_v4();
        let previous = counter(41, lifecycle, 200, 200);

        let (counter_regression, _) =
            derive_cpu_cores(Some(previous), counter(41, lifecycle, 100, 300));
        assert_eq!(counter_regression.value, None);
        assert_eq!(
            counter_regression.reason,
            Some(DiagnosticReason::CounterRegressed)
        );

        let (clock_regression, _) =
            derive_cpu_cores(Some(previous), counter(41, lifecycle, 300, 100));
        assert_eq!(clock_regression.value, None);
        assert_eq!(
            clock_regression.reason,
            Some(DiagnosticReason::ClockRegressed)
        );
    }

    #[test]
    fn equal_monotonic_samples_are_unknown_instead_of_dividing_by_zero() {
        let lifecycle = Uuid::new_v4();
        let previous = counter(41, lifecycle, 200, 200);
        let current = counter(41, lifecycle, 300, 200);

        let (usage, _) = derive_cpu_cores(Some(previous), current);

        assert_eq!(usage.value, None);
        assert_eq!(usage.reason, Some(DiagnosticReason::ClockDidNotAdvance));
    }

    #[test]
    fn independent_field_failure_does_not_hide_available_working_set() {
        let mut collector = ProcessDiagnosticsCollector::new();
        let sample = collector.record_measurements(
            ProcessMeasurements {
                pid: 41,
                cumulative_cpu_time: DiagnosticMetric::unknown(
                    MetricUnit::Nanoseconds,
                    DiagnosticReason::PermissionDenied,
                ),
                working_set_bytes: DiagnosticMetric::available(4096, MetricUnit::Bytes),
                private_bytes: DiagnosticMetric::unknown(
                    MetricUnit::Bytes,
                    DiagnosticReason::Unsupported,
                ),
            },
            Some(1_700_000_000_000),
            100,
        );

        assert_eq!(
            sample.cpu.cumulative_time.reason,
            Some(DiagnosticReason::PermissionDenied)
        );
        assert_eq!(sample.memory.working_set_bytes.value, Some(4096));
        assert_eq!(sample.memory.private_bytes.value, None);
        assert_eq!(
            sample.memory.private_bytes.reason,
            Some(DiagnosticReason::Unsupported)
        );
    }

    #[test]
    fn current_process_smoke_reports_only_native_host_scope() {
        let sample = ProcessDiagnosticsCollector::new().sample();

        assert_eq!(sample.identity.pid, std::process::id());
        assert_eq!(sample.scope, ProcessScope::NativeHostProcess);
        assert_eq!(sample.cpu.cumulative_time.unit, MetricUnit::Nanoseconds);
        assert_eq!(sample.cpu.usage_cores.unit, MetricUnit::CpuCores);
        assert_eq!(sample.memory.working_set_bytes.unit, MetricUnit::Bytes);
        assert_eq!(sample.memory.private_bytes.unit, MetricUnit::Bytes);
        if sample.cpu.cumulative_time.value.is_some() {
            assert_eq!(
                sample.cpu.usage_cores.reason,
                Some(DiagnosticReason::InitialSample)
            );
        }
    }

    #[test]
    fn process_sample_serializes_only_the_diagnostic_allowlist() {
        let sample = ProcessDiagnosticsCollector::new().sample();
        let json = serde_json::to_value(sample).unwrap();
        let encoded = json.to_string();

        assert!(encoded.contains("native_host_process"));
        assert!(encoded.contains("collectorLifecycle"));
        assert!(!encoded.contains("commandLine"));
        assert!(!encoded.contains("environment"));
        assert!(!encoded.contains("password"));
        assert!(!encoded.contains("password"));
        assert!(!encoded.contains("invitation"));
        assert!(!encoded.contains("token"));
        assert!(!encoded.contains("prompt"));
        assert!(!encoded.contains("request"));
        assert!(!encoded.contains("body"));
        assert!(!encoded.contains("password"));
        assert!(!encoded.contains("body"));
    }
}
