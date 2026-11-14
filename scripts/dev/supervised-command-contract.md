# Windows finite-command supervision

Status: implemented; 12 real short-process regressions passed on Windows. A background CLI invocation also supervised an actual Cargo test through its expected nonzero exit and confirmed Job cleanup after the launcher returned. This runner is for finite cargo/node/Gradle commands, not unbounded services. It bounds external execution and exposes a separately readable result; it cannot repair or certify Codex's UI/API result delivery.

```text
bun scripts/dev/supervised-command.ts start --config <absolute JSON path>
bun scripts/dev/supervised-command.ts status --dir <absolute owned artifact dir>
bun scripts/dev/supervised-command.ts cancel --dir <absolute owned artifact dir>
```

```json
{
  "version": 1,
  "artifactDir": "G:/exomind-runs/example-unique-run",
  "executable": "C:/absolute/path/to/node.exe",
  "args": ["C:/absolute/path/to/finite-script.cjs"],
  "cwd": "H:/A137442/Develop/AGI/exomind",
  "timeoutMs": 5000,
  "noProgressTimeoutMs": 1200,
  "bootstrapTimeoutMs": 10000,
  "heartbeatTimeoutMs": 1500
}
```

All paths explicit/absolute; artifactDir must be newly owned, never reuse another run's directory. No shell interpolation. Both total and no-progress limits mandatory; bootstrap and watchdog-ready waits independently bounded. Do not serialize the inherited environment, command argv or tokens into public receipt/status output. Raw task logs stay in the explicit owned artifact dir and are not automatically published. A command can itself print secrets: this runner cannot claim arbitrary log redaction.

TS API: `startSupervisedCommand(config): Promise<LaunchReceipt>`, `readSupervisedCommand(dir): RunObservation`, `cancelSupervisedCommand(dir): CancelReceipt`. Importing the module has no side effects. Start waits only for bounded bootstrap/watchdog readiness, never for command completion or pipe EOF. Returns paths and process identity, with no live pipe keeping a tool call open. Status/cancel are short local file operations.

ProcessIdentity `{pid:number, createdFileTime:string, executablePath:string}`. FILETIME is a decimal string across JSON/TS; never roundtrip through JS number. Native validation and termination use the same opened process handle and require both exact creation time and executable path. No image-name/port/PID-only/taskkill fallback.

Files: receipt.json, status.json, result.json, stdout.log, stderr.log, bootstrap.log, plus private native/config/control artifacts. Receipt contains runId, dir, supervisor/watchdog identities and paths. Status contains runId, phase (bootstrapping/running/cleaning/terminal), heartbeat sequence, lastProgressAt, owned process identities and progress counters. Result is separately created once cleanup is confirmed, not inferred from heartbeat. `readSupervisedCommand` returns `{receipt,status,result}`; missing/unreadable/stale fields remain explicit rather than becoming success.

Terminal `reason`: completed, exit_nonzero, total_timeout, idle_timeout, cancelled, supervisor_lost, heartbeat_timeout, bootstrap_failed, watchdog_failed, ownership_refused, cleanup_failed. Also exitCode|null and cleanup `{confirmed:boolean,jobClosed:boolean}`. No success terminal until the entire owned Job is empty and closed; unconfirmed cleanup is an error, never successful completion. Bootstrap failure must also produce a terminal artifact when the owned directory exists. Long command execution must never be awaited by the launcher.

Timeout/cancellation does not undo side effects already completed by a command. Query the relevant artifact, receipt, installed package or remote state before retrying; do not infer "nothing happened" from a non-success terminal. An observation timeout is not process termination: inspect the same run's result and recorded owner rather than automatically starting a duplicate.

Native supervisor: CreateProcessW suspended with stdout/stderr direct file handles, assign to a kill-on-close Job with no breakaway, require watchdog identity/readiness, then resume. Failure never releases an unassigned/unwatched command. Root exit triggers cleanup of residual descendants immediately; descendant-held file handles do not delay EOF because no command output pipes are consumed. Normal, error, timeout and cancel all terminate only the owned Job and confirm drainage before terminal result.

Work progress is task stdout/stderr byte growth or cumulative Job user+kernel CPU increase. Supervisor heartbeat/CPU, watchdog activity and status-file writes are not work progress. Absolute deadline still applies to a chatty/busy task. Independent native watchdog guards supervisor absolute deadline/heartbeat, validates one supervisor handle, and on death/hang causes its owned Job to be closed/cleaned. It must not target a recycled PID or unrelated sentinel. Supervisor also detects watchdog death; it does not keep running unguarded. Compiler/bootstrap has a separate short timeout and owns its direct bootstrap process handle; no task starts before native guards are ready.

Tests use bounded Node fixtures (self-exit within seconds even if supervision regresses), never a real cargo/Gradle hang. Coverage: normal/nonzero, silent idle timeout, genuine CPU progress, total deadline despite output, cancel, root-exit with descendant inheriting stdout, independent watchdog after supervisor death/suspension, watchdog death, bootstrap bad executable, unrelated same-image sentinel. Test-only native suspension/termination requires the exact owned run's recorded identity and a single verified handle; it is not a production generic stop interface.
