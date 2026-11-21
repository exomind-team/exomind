# Beta25 candidate and remaining acceptance matrix

> 状态：精确候选已完成；本机产品回归通过；完整 Beta 验收受真实外部条件阻塞。

## Candidate identity

| Field | Value |
|---|---|
| Version / Core / Android code | `0.6.0-beta25` / 11 / 6025 |
| Functional source | `5051a6bc44926191c340e818f1856a5a38300634` |
| Versioned payload | `97b642f9770609c9fe8d77a6d67e53a71b7b815a` |
| Request-only recipe | `bcabadaa196e1caae17b2535c4efc4a622d383cb` |
| Source Contracts | `44864566219` (functional), `44865697733` (versioned), both successful |
| Build Validation | `44866998175`, resolver + Windows/Linux/macOS/Android successful |

The current candidate is internal validation output. It has no public release,
tag or Pages publication.

## Product fix delivered

Commit `5051a6bc` closes the three Beta24 P2 regressions:

1. attachment capture freezes a command and immediately publishes a clean next
   draft;
2. failed/unknown submissions restore a draft only when no newer user input
   exists, with restored drafts bound to their exact pending command;
3. custom countdown minutes reject non-integers or values outside 1-720;
4. cancelled exports no longer claim that a nonexistent package or manifest is
   available for inspection.

The first full Beta run after the change also exposed and fixed a retry case
where one restored draft could borrow an older pending command from the same
profile.

## Evidence

- [Beta25 completion handoff](H:/A137442/Develop/AGI/exomind-agent-artifacts/beta-completion-20261119-a/beta25-completion-20261121/README.md)
- [Progress and red/green ledger](H:/A137442/Develop/AGI/exomind-agent-artifacts/beta-completion-20261119-a/beta25-completion-20261121/progress-and-evidence.md)
- [Issues and recovery conditions](H:/A137442/Develop/AGI/exomind-agent-artifacts/beta-completion-20261119-a/beta25-completion-20261121/issues-and-resolutions.md)
- [A result](H:/A137442/Develop/AGI/exomind-agent-artifacts/beta-completion-20261119-a/beta25-user-a/REPORT.md)
- [B result](H:/A137442/Develop/AGI/exomind-agent-artifacts/beta-completion-20261119-a/beta25-user-b/report.md)
- [Candidate evidence](H:/A137442/Develop/AGI/exomind-agent-artifacts/beta-completion-20261119-a/resume-20261120/beta25-candidate-evidence.json)

Local source results:

- targeted P2 regression: 4 files, 40/40;
- complete Beta UI: 103 files, 776/776;
- type check and production Web build: exit 0;
- staged imports: 164 files, no missing local imports.

Exact Windows:

- 68,542,464 bytes;
- SHA-256
  `d6c721cfac4d3a231a11f6d1def6573476c875e83fd3a5f1dda3bcea77d3aa5d`;
- PE product/file version `0.6.0-beta25`;
- PE magic present; Authenticode `NotSigned`.

Android:

- arm64 signed APK
  `4d0c1ea4bb48d4a6a9c561a55b8f055a0fe093071edc0e7a665d75fdd14c298a`;
- x86_64 signed APK
  `179644a9081a2da4a1b7b771616db7e0e70843978b82d4649c47442f793a0639`;
- historical Beta certificate retained;
- each has 935 identical non-signature entries and 15 pixel-identical brand PNGs;
- runtime/upgrade remain untested.

macOS/Linux raw validation archives were downloaded and hash-checked. Neither
was installed or run.

Root exact-Windows smoke showed `外心 · 0.6.0 beta25`, the expected live
device/runtime identity and Core11 capabilities, then exited normally: app exit
0, supervisor exit 0, cleanup confirmed and Job closed.

## Independent fresh users

Both users ran independently on explicit `deepseek/deepseek-v4-pro`, in separate
synthetic data roots, and did not share findings.

| Story | User A | User B | Current interpretation |
|---|---|---|---|
| S01 | pass | pass | local record/draft/restart and receipt boundary pass |
| S02 | partial | partial | invite generation passes; second-device join/backfill unavailable |
| S03 | pass | pass | same-name ID display and local profile isolation pass; real discovery remains untested |
| S04 | partial | partial | stable device identity passes; VPN/network/OEM matrix unavailable |
| S05 | pass | pass | small/9 MiB attachments and D01 pass; remote on-demand branches remain unavailable |
| S06 | pass | pass | timer/countdown/rotate/feedback/D02 pass; cross-device conflict/clock skew remains unavailable |
| S07 | partial | partial | job/config/coverage boundary passes; real model generation unavailable |
| S08 | partial | partial | grant/revoke UI and unauthorized 404 pass; credentialed external Agent HTTP unavailable |
| S09 | pass | pass | synthetic image/audio/video-deferred/unknown and compact viewport pass; physical microphone remains unavailable |
| S10 | pass | partial | D03 cancel copy and local lifecycle pass; successful OS save/hash and expiry purge remain unavailable |

Both users passed D01, D02 and D03. No correctness defect was newly confirmed.
One P3 UX observation remains: in S06 the start action is enabled with an empty
timeblock name and rejects only after click.

Harness checks:

- A: 18 sessions and 19 supervised runs; all normal, exit 0 and clean.
- B: 43 sessions and 43 archived app results; all normal, exit 0, all app PIDs
  gone; final supervisor clean.
- A indexed 394 evidence files with 52 story references.
- B indexed 158 evidence files with 162 story/regression references.

## Remaining acceptance matrix

| Requirement | Missing condition | Next validation |
|---|---|---|
| second-device join/backfill | same-version second Host/profile | invitation claim, duplicate/cancel/restart, automatic backfill |
| discovery and authorization | two machines on controlled LAN/EasyTier | discovery never grants access; explicit join only |
| network continuity | controllable WiFi/VPN/TUN/OEM and sleep | first reconnect, return route, identity/provenance and state recovery |
| real review provider | approved model configuration | current prompt/source materials, coverage gaps, late input, cancel/restart and human quality |
| external Agent | safe non-clipboard credential channel | hello/access-check, bounded paging/read/append/wait/receipt and revoke rejection |
| successful export | interactive OS save dialog | archive bytes/SHA-256, manifest, missing items and source preservation |
| Android | physical device/approved emulator and previous Beta | fresh, preserve-data upgrade, sync, background and UI/system-bar behavior |
| physical microphone | authorized safe capture | permission, failure/retry, background and orientation |
| expiry purge/follow-up | reclaim deadline and authorized peer | local purge with unchanged remote bytes, explicit follow-up, no automatic remote deletion |

Video-local preview remains deferred; raw bytes, length/hash, authorization and
missing-item semantics remain in scope.

## Status

This checkpoint does **not** claim full Beta acceptance. The candidate and local
product regression are complete; the next round requires one of the external
prerequisites above and should not rerun already-proven source/build gates unless
source changes or evidence is invalidated.
