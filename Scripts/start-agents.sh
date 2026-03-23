#!/usr/bin/env bash
# start-agents.sh — Start all SignalPool agents
#
# Usage:
#   ./scripts/start-agents.sh
#   EXOMIND_RT_URL=http://192.168.1.5:1949 ./scripts/start-agents.sh
#
# Agents started:
#   - classifier: routes user.input.text → input.classified
#   - reviewer:   routes session.end / timeblock.completed → review.completed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENTS_DIR="$PROJECT_ROOT/packages/ts-agent-cli/agents"

export EXOMIND_RT_URL="${EXOMIND_RT_URL:-http://localhost:1949}"

echo "[start-agents] RT URL: $EXOMIND_RT_URL"
echo "[start-agents] Starting classifier + reviewer agents..."

# Start agents in background
bun run "$AGENTS_DIR/classifier/index.ts" &
CLASSIFIER_PID=$!
echo "[start-agents] classifier started (PID: $CLASSIFIER_PID)"

bun run "$AGENTS_DIR/reviewer/index.ts" &
REVIEWER_PID=$!
echo "[start-agents] reviewer started (PID: $REVIEWER_PID)"

# Graceful shutdown
cleanup() {
  echo ""
  echo "[start-agents] Shutting down agents..."
  kill "$CLASSIFIER_PID" "$REVIEWER_PID" 2>/dev/null || true
  wait "$CLASSIFIER_PID" "$REVIEWER_PID" 2>/dev/null || true
  echo "[start-agents] All agents stopped."
}

trap cleanup SIGINT SIGTERM

echo "[start-agents] All agents running. Press Ctrl+C to stop."
wait
