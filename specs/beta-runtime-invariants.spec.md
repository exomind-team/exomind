spec: task
name: "beta-runtime-invariants"
satisfies: [REQ-BETA-RUNTIME]
tags: [beta, regression, lifecycle]
---

## Intent

Keep three existing Native-workspace regression obligations executable during
Beta iteration. The contract protects the owning layer and does not certify a
packaged application, a physical device, appearance, or energy consumption.

## Decisions

- The Native workspace remains the owner when no Main document exists.
- Workspace observations reuse qualified authorization instead of minting rows.
- Competing drafts use compare-and-update and preserve newer or corrupt input.
- Native proof uses the existing isolated exomind-beta-host integration tests.

## Boundaries

### Allowed Changes
- .agent-spec/config.yaml
- .github/workflows/beta-contract-guard.yml
- ./.gitignore
- AGENTS.md
- ./package.json
- knowledge/**
- specs/**
- scripts/dev/beta-contract-*.ts
- tests/unit/scripts/beta-contract-*.test.ts
- crates/exomind-beta-host/**
- src-tauri/src/beta*
- src/beta/**
- tests/unit/beta/**
- docs/development/beta-iteration-guards.md
- docs/plans/2026-11-19-v0.6-industrial-iteration-roadmap.md
- docs/AI-CONTEXT.md

### Forbidden
- Do not change product data schemas, pairing authority or signing rules.
- Do not run these tests against a user's data directory or daily application.
- Do not count skip, uncertain or pending_review verdicts as accepted proof.

## Completion Criteria

Rule: independent-owner — Native operation without Main
Scenario: Main window absent
  Test:
    Package: exomind-beta-host
    Filter: native_workspace_controls_and_drafts_need_no_main_window_or_frontend_executor
  Given an active timeblock and no Main document or frontend executor
  When the workspace pauses, resumes, ends and submits its feedback
  Then the accepted facts and draft acknowledgements retain the same profile

Rule: read-without-grants — Observation has no authorization side effect
Scenario: Repeated observations do not create grants
  Test:
    Package: exomind-beta-host
    Filter: repeated_reads_do_not_mint_grants
  Given one qualified Native observation
  When the same profile is observed ten more times
  Then the authorization row count equals the established baseline

Rule: reject-stale-writers — Newer and corrupt input survives
Scenario: Stale client is rejected
  Test:
    Package: exomind-beta-host
    Filter: a_stale_client_cannot_overwrite_another_clients_new_draft_or_a_corrupt_intent
  Given another client has saved a newer draft or the saved intent is corrupt
  When a stale client attempts to replace that intent
  Then the stale operation fails and the original persisted input remains

## Out of Scope

- A general intent scheduler, Atlas integration or automatic worktree creation.
- Packaged Windows or Android runtime acceptance and physical-device testing.
- Layout quality, visual approval, network recovery and energy measurements.
