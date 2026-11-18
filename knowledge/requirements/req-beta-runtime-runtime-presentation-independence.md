---
kind: requirement
id: REQ-BETA-RUNTIME
title: "runtime-presentation-independence"
status: accepted
liveness: auto
tags: [beta, lifecycle, regression]
---

## Problem

Beta12 tied floating-workbench freshness to a visible Main panel. Hiding focus
disabled the other control surface although Native kept timing. Repeated reads
also created authorization rows, and competing clients could overwrite drafts.
These are ownership and state-transition failures, not display preferences.

## Requirements

[REQ-BETA-RUNTIME] The Native workspace MUST accept qualified commands while Main is absent.

[REQ-BETA-RUNTIME-READ] Repeated workspace observation MUST NOT create authorization rows after the first qualified observation.

[REQ-BETA-RUNTIME-CAS] A stale workspace client MUST NOT overwrite a newer persisted draft.

## Scenarios

Rule: REQ-BETA-RUNTIME
Scenario: No Main document
  Given an active timeblock and no frontend executor
  When a workspace client pauses, resumes, ends and submits feedback
  Then Native returns accepted action receipts for the original profile

Rule: REQ-BETA-RUNTIME-READ
Scenario: Repeated observations
  Given one qualified workspace observation
  When the same profile is observed ten more times
  Then the authorization query returns the same row count as the first read

Rule: REQ-BETA-RUNTIME-CAS
Scenario: Stale writer
  Given another client has saved a newer draft
  When a stale client attempts an update
  Then the update returns a conflict error and persisted text equals the newer input

## Dependencies

None.

## Source Trace

- docs/architecture/principles.md: presentation independence, confirmed by the
  user on 2026-11-18: hiding a view changes display only; the floating window
  depends on Native data and services, not Main.
- docs/development/beta-native-workspace.md: independent Native execution,
  compare-and-update drafts, and observation without new grants.
- docs/plans/2026-11-18-beta13-shell-and-desktop-feedback.md: reproduced failure,
  owning-layer repair, regression evidence and explicit device limitations.

## Open Questions

None.

## Next

Maintain the explicit tests in specs/beta-runtime-invariants.spec.md. This accepted
requirement records existing user-confirmed behavior; it adds no product scope.
