# Dev Daily Midday Report 2026-03-30 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the 12:00-18:00 development midday report plus HTML export using the dev-daily skill workflow and live gh/git data.

**Architecture:** Enumerate all installed skills, load the dev-daily skill references, collect real-time repository status via gh CLI and git commands, then render both markdown-style human summary and HTML report artifacts under `temp/` following the skill templates.

**Tech Stack:** git, gh CLI, POSIX shell utilities, Node toolchain for formatting if required by dev-daily skill.

---

### Task 1: Inventory installed skills

**Files:**
- Read: `skills/` directory contents
- Create: `temp/dev-daily/skills-20260330.txt`

- [ ] **Step 1: List skill directories**

Run: `ls skills > temp/dev-daily/skills-20260330.txt`
Expected: Text file containing one subdirectory per skill.

- [ ] **Step 2: Capture SKILL.md paths**

Run: `find skills -name SKILL.md | sort >> temp/dev-daily/skills-20260330.txt`
Expected: File shows each skill entry path for user reference.

- [ ] **Step 3: Review file for completeness**

Run: `cat temp/dev-daily/skills-20260330.txt`
Expected: Output ready to include in final report.

### Task 2: Load dev-daily skill instructions

**Files:**
- Read: `skills/dev-daily/SKILL.md`
- Create: `temp/dev-daily/dev-daily-skill-notes.md`

- [ ] **Step 1: Open SKILL.md**

Run: `cat skills/dev-daily/SKILL.md | tee temp/dev-daily/dev-daily-skill-notes.md`
Expected: Notes file containing the instructions.

- [ ] **Step 2: Follow Load Order references**

For each reference path listed in SKILL.md Load Order, run `cat <path> >> temp/dev-daily/dev-daily-skill-notes.md` in the specified sequence so the notes reflect the entire workflow context.

- [ ] **Step 3: Extract mandatory deliverables**

Review the notes file and jot down required sections/fields for the midday report and HTML template.

### Task 3: Collect live repository data via gh/git

**Files:**
- Create: `temp/dev-daily/midday-data.json`

- [ ] **Step 1: Capture git status snapshot**

Run: `git status -sb > temp/dev-daily/midday-data.json`
Expected: File begins with working tree summary.

- [ ] **Step 2: Record commits between 12:00 and 18:00 CST**

Run: `git log --since "2026-03-30 12:00" --until "2026-03-30 18:00" --pretty=format:'%h %ad %s' --date=iso >> temp/dev-daily/midday-data.json`
Expected: Chronological commit lines for the target window.

- [ ] **Step 3: Pull issue/PR activity via gh**

Run: `gh issue list --limit 50 --state all --json number,title,assignees,state,updatedAt >> temp/dev-daily/midday-data.json`
Run: `gh pr list --limit 50 --state all --json number,title,author,state,updatedAt,headRefName,baseRefName >> temp/dev-daily/midday-data.json`
Expected: JSON payload appended to data file for referencing progress/blockers.

- [ ] **Step 4: Capture CI or deployment signals if dev-daily requires**

If SKILL references workflows/builds, run commands like `gh run list --limit 20 --json databaseId,status,createdAt,headBranch`. Append to data file.

### Task 4: Draft textual midday report per dev-daily template

**Files:**
- Create: `temp/dev-daily/report-20260330-1200-1800.md`

- [ ] **Step 1: Outline sections**

Using SKILL template, create headings (e.g., Progress, Plans, Blockers, Metrics) in the markdown file via `cat <<'EOF' > ...`.

- [ ] **Step 2: Populate with live data**

Transform the gh/git data into bullet points inserted under each section. Reference specific issue/PR numbers and timestamps.

- [ ] **Step 3: QA report completeness**

Re-read SKILL requirements to ensure every required section/time window is covered and cross-check data with source commands.

### Task 5: Generate HTML report artifact

**Files:**
- Create: `temp/dev-daily/report-20260330-1200-1800.html`
- Read: HTML template referenced by dev-daily skill

- [ ] **Step 1: Copy HTML template**

Run: `cat <template-path> > temp/dev-daily/report-20260330-1200-1800.html`
Expected: Base HTML structure ready for injection.

- [ ] **Step 2: Inject textual report**

Use `perl -0pi -e 's/{{CONTENT}}/`cat temp/...md`/e' temp/...html` or template-specific instructions to embed markdown or plain text per skill guidance.

- [ ] **Step 3: Validate HTML**

Run: `tidy -errors temp/dev-daily/report-20260330-1200-1800.html` (if available) or simple `grep` to ensure required sections exist.

### Task 6: Deliver results to user

**Files:**
- Read: `temp/dev-daily/skills-20260330.txt`, `temp/dev-daily/report-20260330-1200-1800.md`, `temp/dev-daily/report-20260330-1200-1800.html`

- [ ] **Step 1: Summarize artifacts**

List created files with relative paths for user.

- [ ] **Step 2: Highlight data sources**

Document commands executed and confirm all data derived from gh/git.

- [ ] **Step 3: Suggest next steps**

Recommend verification actions (e.g., share HTML, store in repo) if applicable.
