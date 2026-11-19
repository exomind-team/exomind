use super::ProcessMeasurements;
use crate::diagnostics::{DiagnosticMetric, DiagnosticReason, MetricUnit};
use std::{ffi::c_void, mem::size_of};

#[repr(C)]
#[derive(Default)]
struct FileTime {
    low_date_time: u32,
    high_date_time: u32,
}

#[repr(C)]
#[derive(Default)]
struct ProcessMemoryCountersEx {
    _cb: u32,
    _page_fault_count: u32,
    _peak_working_set_size: usize,
    working_set_size: usize,
    _quota_peak_paged_pool_usage: usize,
    _quota_paged_pool_usage: usize,
    _quota_peak_non_paged_pool_usage: usize,
    _quota_non_paged_pool_usage: usize,
    _pagefile_usage: usize,
    _peak_pagefile_usage: usize,
    private_usage: usize,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    #[link_name = "GetCurrentProcess"]
    fn get_current_process() -> *mut c_void;
    #[link_name = "GetCurrentProcessId"]
    fn get_current_process_id() -> u32;
    #[link_name = "GetProcessTimes"]
    fn get_process_times(
        process: *mut c_void,
        creation_time: *mut FileTime,
        exit_time: *mut FileTime,
        kernel_time: *mut FileTime,
        user_time: *mut FileTime,
    ) -> i32;
}

#[link(name = "psapi")]
unsafe extern "system" {
    #[link_name = "GetProcessMemoryInfo"]
    fn get_process_memory_info(
        process: *mut c_void,
        counters: *mut ProcessMemoryCountersEx,
        size: u32,
    ) -> i32;
}

pub(super) fn sample_process() -> ProcessMeasurements {
    // SAFETY: this pseudo-handle is owned by the current process and must not be closed.
    let process = unsafe { get_current_process() };
    // SAFETY: this query has no arguments and returns the current process identifier.
    let pid = unsafe { get_current_process_id() };

    let mut creation_time = FileTime::default();
    let mut exit_time = FileTime::default();
    let mut kernel_time = FileTime::default();
    let mut user_time = FileTime::default();
    // SAFETY: all output pointers refer to initialized writable FILETIME values.
    let cpu_available = unsafe {
        get_process_times(
            process,
            &mut creation_time,
            &mut exit_time,
            &mut kernel_time,
            &mut user_time,
        )
    } != 0;
    let cumulative_cpu_time = if cpu_available {
        match (filetime_ns(&kernel_time), filetime_ns(&user_time)) {
            (Some(kernel_ns), Some(user_ns)) => kernel_ns
                .checked_add(user_ns)
                .map(|time| DiagnosticMetric::available(time, MetricUnit::Nanoseconds))
                .unwrap_or_else(|| {
                    DiagnosticMetric::unknown(
                        MetricUnit::Nanoseconds,
                        DiagnosticReason::InvalidData,
                    )
                }),
            _ => DiagnosticMetric::unknown(MetricUnit::Nanoseconds, DiagnosticReason::InvalidData),
        }
    } else {
        DiagnosticMetric::unknown(MetricUnit::Nanoseconds, DiagnosticReason::Unavailable)
    };

    let mut counters = ProcessMemoryCountersEx {
        _cb: size_of::<ProcessMemoryCountersEx>() as u32,
        ..ProcessMemoryCountersEx::default()
    };
    // SAFETY: `counters` has the documented PROCESS_MEMORY_COUNTERS_EX layout and size.
    let memory_available = unsafe {
        get_process_memory_info(
            process,
            &mut counters,
            size_of::<ProcessMemoryCountersEx>() as u32,
        )
    } != 0;
    let (working_set_bytes, private_bytes) = if memory_available {
        (
            DiagnosticMetric::available(counters.working_set_size as u64, MetricUnit::Bytes),
            DiagnosticMetric::available(counters.private_usage as u64, MetricUnit::Bytes),
        )
    } else {
        (
            DiagnosticMetric::unknown(MetricUnit::Bytes, DiagnosticReason::Unavailable),
            DiagnosticMetric::unknown(MetricUnit::Bytes, DiagnosticReason::Unavailable),
        )
    };

    ProcessMeasurements {
        pid,
        cumulative_cpu_time,
        working_set_bytes,
        private_bytes,
    }
}

fn filetime_ns(value: &FileTime) -> Option<u64> {
    let ticks = (u64::from(value.high_date_time) << 32) | u64::from(value.low_date_time);
    ticks.checked_mul(100)
}
