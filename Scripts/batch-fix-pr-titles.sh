#!/bin/bash
# 批量修正 PR 标题

set -e

input_file="$1"
if [ -z "$input_file" ]; then
  echo "用法: $0 <pr-title-fixes.txt>"
  exit 1
fi

count=0
total=$(grep -v "^#" "$input_file" | grep -v "^$" | wc -l)

echo "开始处理 $total 个 PR..."

while IFS='|' read -r pr_num new_title; do
  # 跳过注释和空行
  [[ "$pr_num" =~ ^#.*$ ]] && continue
  [[ -z "$pr_num" ]] && continue

  count=$((count + 1))
  echo "[$count/$total] 修正 PR #$pr_num"

  if gh pr edit "$pr_num" --title "$new_title" 2>&1 | grep -q "https://"; then
    echo "  ✓ 成功"
  else
    echo "  ✗ 失败，跳过"
  fi

  # 避免 API 限流
  sleep 0.5
done < "$input_file"

echo "完成！共处理 $count 个 PR"
