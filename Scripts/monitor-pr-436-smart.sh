#!/bin/bash
# PR #436 智能监控脚本 - 检测变化并记录

PR_NUMBER=436
STATE_FILE=".exomind/pr-436-state.json"
LOG_FILE=".exomind/pr-436-monitor.log"

# 确保目录存在
mkdir -p .exomind

# 记录日志
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 获取当前状态
get_current_state() {
    gh pr view $PR_NUMBER --json \
        state,isDraft,reviewDecision,mergeable,reviews,comments \
        --jq '{
            state,
            isDraft,
            reviewDecision,
            mergeable,
            lastReviewTime: (.reviews | sort_by(.submittedAt) | reverse | .[0].submittedAt // ""),
            lastCommentTime: (.comments | sort_by(.createdAt) | reverse | .[0].createdAt // ""),
            reviewCount: (.reviews | length),
            commentCount: (.comments | length)
        }'
}

# 比较状态
compare_states() {
    if [ ! -f "$STATE_FILE" ]; then
        log "📝 首次运行，保存初始状态"
        get_current_state > "$STATE_FILE"
        return 0
    fi

    local old_state=$(cat "$STATE_FILE")
    local new_state=$(get_current_state)

    # 保存新状态
    echo "$new_state" > "$STATE_FILE"

    # 检测变化
    local changes=0

    # 检查审查决定
    local old_decision=$(echo "$old_state" | jq -r '.reviewDecision')
    local new_decision=$(echo "$new_state" | jq -r '.reviewDecision')
    if [ "$old_decision" != "$new_decision" ]; then
        log "🎯 审查决定变化: $old_decision -> $new_decision"
        changes=$((changes + 1))
    fi

    # 检查审查数量
    local old_reviews=$(echo "$old_state" | jq -r '.reviewCount')
    local new_reviews=$(echo "$new_state" | jq -r '.reviewCount')
    if [ "$old_reviews" != "$new_reviews" ]; then
        log "👀 新增审查: $old_reviews -> $new_reviews"
        changes=$((changes + 1))
    fi

    # 检查评论数量
    local old_comments=$(echo "$old_state" | jq -r '.commentCount')
    local new_comments=$(echo "$new_state" | jq -r '.commentCount')
    if [ "$old_comments" != "$new_comments" ]; then
        log "💬 新增评论: $old_comments -> $new_comments"
        changes=$((changes + 1))
    fi

    # 检查可合并性
    local old_mergeable=$(echo "$old_state" | jq -r '.mergeable')
    local new_mergeable=$(echo "$new_state" | jq -r '.mergeable')
    if [ "$old_mergeable" != "$new_mergeable" ]; then
        log "⚠️ 可合并性变化: $old_mergeable -> $new_mergeable"
        changes=$((changes + 1))
    fi

    return $changes
}

# 显示当前状态
show_status() {
    log "🔍 检查 PR #$PR_NUMBER 状态..."

    local state=$(get_current_state)

    echo ""
    echo "📋 当前状态:"
    echo "$state" | jq '.'

    echo ""
    echo "🔧 CI 状态:"
    gh pr checks $PR_NUMBER

    echo ""
}

# 主逻辑
main() {
    log "========== 开始监控 =========="

    show_status

    compare_states
    local changes=$?

    if [ $changes -gt 0 ]; then
        log "⚡ 检测到 $changes 个变化！"

        # 显示最新审查
        echo ""
        echo "👀 最新审查:"
        gh pr view $PR_NUMBER --json reviews --jq '.reviews | sort_by(.submittedAt) | reverse | .[0] | {author: .author.login, state: .state, submittedAt: .submittedAt, body: .body[:200]}'

        # 显示最新评论
        echo ""
        echo "💬 最新评论:"
        gh pr view $PR_NUMBER --json comments --jq '.comments | sort_by(.createdAt) | reverse | .[0] | {author: .author.login, createdAt: .createdAt, body: .body[:200]}'
    else
        log "✅ 无变化"
    fi

    log "========== 监控完成 =========="
    echo ""
}

main
