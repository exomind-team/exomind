//! On-demand, local-only diagnostics with an explicit schema and field scope.
//! The serialized types below contain only fixed identifiers, timestamps,
//! metrics, and bounded reason codes; they have no path or free-form error slot.

pub mod process;
pub mod scans;
pub mod storage;

use serde::Serialize;

/// Version of the allowlisted process and storage diagnostic DTOs.
pub const DIAGNOSTICS_SCHEMA_VERSION: u16 = 1;

/// Bounded reasons for unavailable measurements or partial scans.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticReason {
    Unsupported,
    PermissionDenied,
    Unavailable,
    InvalidData,
    InitialSample,
    IdentityChanged,
    CounterRegressed,
    ClockDidNotAdvance,
    ClockRegressed,
    BudgetExceeded,
    Cancelled,
    EntryUnavailable,
    InvalidRoot,
}

/// Unit attached to every scalar process metric.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricUnit {
    Nanoseconds,
    Bytes,
    CpuCores,
}

/// Whether a scalar value is a real measurement or explicitly unknown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricAvailability {
    Available,
    Unknown,
}

/// An allowlisted scalar measurement. Unknown values always have no numeric
/// value and a bounded reason code; unavailable data is never encoded as zero.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct DiagnosticMetric<T> {
    pub value: Option<T>,
    pub unit: MetricUnit,
    pub availability: MetricAvailability,
    pub reason: Option<DiagnosticReason>,
}

impl<T> DiagnosticMetric<T> {
    pub(crate) fn available(value: T, unit: MetricUnit) -> Self {
        Self {
            value: Some(value),
            unit,
            availability: MetricAvailability::Available,
            reason: None,
        }
    }

    pub(crate) fn unknown(unit: MetricUnit, reason: DiagnosticReason) -> Self {
        Self {
            value: None,
            unit,
            availability: MetricAvailability::Unknown,
            reason: Some(reason),
        }
    }
}

/// JSON numbers cannot preserve long-running u64 nanosecond counters in JS.
/// Keep OS arithmetic as integers, and use decimal strings only at serialization.
pub(crate) fn serialize_nanoseconds<S: serde::Serializer>(
    value: &u64,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&value.to_string())
}

pub(crate) fn serialize_nanosecond_metric<S: serde::Serializer>(
    metric: &DiagnosticMetric<u64>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    #[derive(Serialize)]
    struct WireMetric<'a> {
        value: Option<String>,
        unit: &'a MetricUnit,
        availability: &'a MetricAvailability,
        reason: &'a Option<DiagnosticReason>,
    }
    WireMetric {
        value: metric.value.map(|value| value.to_string()),
        unit: &metric.unit,
        availability: &metric.availability,
        reason: &metric.reason,
    }
    .serialize(serializer)
}

#[cfg(test)]
mod wire_precision_tests {
    use super::process::{
        ProcessCpuDiagnostics, ProcessIdentity, ProcessMemoryDiagnostics, ProcessResourceSample,
        ProcessScope,
    };
    use super::*;

    #[test]
    fn process_nanoseconds_remain_exact_across_json_and_javascript() {
        let sample = ProcessResourceSample {
            schema_version: 1,
            scope: ProcessScope::NativeHostProcess,
            identity: ProcessIdentity {
                pid: 42,
                collector_lifecycle: uuid::Uuid::new_v4(),
            },
            sampled_at_unix_ms: Some(1_795_000_000_000),
            monotonic_elapsed_ns: u64::MAX,
            cpu: ProcessCpuDiagnostics {
                cumulative_time: DiagnosticMetric::available(u64::MAX, MetricUnit::Nanoseconds),
                usage_cores: DiagnosticMetric::available(0.0, MetricUnit::CpuCores),
                measurement_window: DiagnosticMetric::available(
                    5_000_000_000,
                    MetricUnit::Nanoseconds,
                ),
            },
            memory: ProcessMemoryDiagnostics {
                working_set_bytes: DiagnosticMetric::available(0, MetricUnit::Bytes),
                private_bytes: DiagnosticMetric::unknown(
                    MetricUnit::Bytes,
                    DiagnosticReason::Unsupported,
                ),
            },
        };
        let wire = serde_json::to_value(sample).unwrap();
        assert_eq!(
            wire["monotonicElapsedNs"].as_str(),
            Some("18446744073709551615")
        );
        assert_eq!(
            wire["cpu"]["cumulativeTime"]["value"].as_str(),
            Some("18446744073709551615")
        );
        assert_eq!(
            wire["cpu"]["measurementWindow"]["value"].as_str(),
            Some("5000000000")
        );
        assert_eq!(wire["memory"]["workingSetBytes"]["value"], 0);
        assert!(wire["memory"]["privateBytes"]["value"].is_null());
    }

    #[test]
    fn scan_elapsed_nanoseconds_are_decimal_strings_without_changing_byte_counters() {
        let root = tempfile::tempdir().unwrap();
        let mut report = storage::scan_host_storage(
            root.path(),
            storage::StorageScanLimits::default(),
            &storage::CancellationToken::new(),
        );
        report.elapsed_ns = u64::MAX;
        let wire = serde_json::to_value(report).unwrap();
        assert_eq!(wire["elapsedNs"].as_str(), Some("18446744073709551615"));
        assert_eq!(wire["logicalBytesCounted"], 0);
    }
}
