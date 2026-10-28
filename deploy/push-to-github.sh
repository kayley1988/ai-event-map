#!/usr/bin/env bash
# 一键把自己的仓库接上 GitHub（在 Git Bash 里跑）
# 用法：bash deploy/push-to-github.sh 你的GitHub用户名 [仓库名]
set -euo pipefail

USER_NAME="${1:-}"
REPO="${2:-ai-event-map}"

if [ -z "$USER_NAME" ]; then
  echo "用法: bash deploy/push-to-github.sh <GitHub用户名> [仓库名]"
  echo "例:   bash deploy/push-to-github.sh zhouqian ai-event-map"
  exit 1
fi

cd "$(dirname "$0")/.."

REMOTE="https://github.com/${USER_NAME}/${REPO}.git"

echo "→ 检查远端仓库是否存在…"
if ! git ls-remote "$REMOTE" >/dev/null 2>&1; then
  echo ""
  echo "✗ 访问不到 $REMOTE"
  echo "  请先在 https://github.com/new 创建一个空的公开仓库：$REPO"
  echo "  （不要勾选 README / .gitignore / license）"
  exit 1
fi

echo "→ 设置 remote"
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE"

echo "→ 推送代码（首次会弹浏览器授权 GitHub 账号）"
git push -u origin main

cat <<EOF

✓ 代码已推送到 $REMOTE

还剩最后一步（约 30 秒）：
  1. 打开 https://github.com/${USER_NAME}/${REPO}/settings/pages
  2. Source 选 "GitHub Actions"（不要选 Deploy from a branch）
  3. 打开 https://github.com/${USER_NAME}/${REPO}/actions 手动点一次
     "Run workflow" 验证流水线

站点地址：https://${USER_NAME}.github.io/${REPO}/
EOF
