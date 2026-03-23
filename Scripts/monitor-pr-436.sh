#!/bin/bash
# PR #436 状态监控脚本

echo "🔍 监控 PR #436 状态..."
echo ""

# 检查 PR 基本状态
echo "📋 PR 基本信息:"
gh pr view 436 --json state,isDraft,reviewDecision,mergeable --jq '{state, isDraft, reviewDecision, mergeable}'
echo ""

# 检查最新审查
echo "👀 最新审查:"
gh pr view 436 --json reviews --jq '.reviews | sort_by(.submittedAt) | reverse | .[0] | {author: .author.login, state: .state, submittedAt: .submittedAt}'
echo ""

# 检查 CI 状态
echo "🔧 CI 状态:"
gh pr checks 436
echo ""

# 检查最新评论
echo "💬 最新评论:"
gh pr view 436 --json comments --jq '.comments | sort_by(.createdAt) | reverse | .[0] | {author: .author.login, createdAt: .createdAt, body: .body[:100]}'
echo ""

echo "✅ 监控完成"
