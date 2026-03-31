#!/bin/bash
# 批量规范化 PR 和 Issue 标题格式

set -e

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "开始规范化 closed PR 和 issue 标题..."

# 获取所有 closed PR
echo -e "${YELLOW}正在获取 closed PR 列表...${NC}"
gh pr list --state closed --limit 1000 --json number,title > /tmp/closed_prs.json

# 获取所有 closed issue
echo -e "${YELLOW}正在获取 closed issue 列表...${NC}"
gh issue list --state closed --limit 1000 --json number,title > /tmp/closed_issues.json

# 处理 PR
echo -e "${GREEN}开始处理 PR...${NC}"
total_prs=$(jq 'length' /tmp/closed_prs.json)
echo "共 $total_prs 个 closed PR"

# 处理 issue
echo -e "${GREEN}开始处理 issue...${NC}"
total_issues=$(jq 'length' /tmp/closed_issues.json)
echo "共 $total_issues 个 closed issue"

echo -e "${GREEN}完成！${NC}"
