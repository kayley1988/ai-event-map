#!/usr/bin/env bash
#
# 一键部署到服务器
# 用法：bash deploy.sh <user@server> [站点目录]
#  例：  bash deploy.sh root@1.2.3.4 /opt/ai-map
#
set -euo pipefail

TARGET="${1:?用法: bash deploy.sh <user@server> [远端目录]}"
REMOTE_DIR="${2:-/opt/ai-map}"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STAMP=$(date +%Y%m%d-%H%M%S)
TARBALL="/tmp/ai-map-${STAMP}.tar.gz"

echo "▸ 本地目录: ${LOCAL_DIR}"
echo "▸ 目标: ${TARGET}:${REMOTE_DIR}"

# 1. 打包（排除缓存、登录态、临时文件）
echo "▸ 打包中…"
tar --exclude='data/.cache' \
    --exclude='data/auth' \
    --exclude='data/browser-out' \
    --exclude='shots' \
    --exclude='node_modules' \
    --exclude='.git' \
    -czf "${TARBALL}" -C "${LOCAL_DIR}" .

echo "▸ 打包完成: $(du -h "${TARBALL}" | cut -f1)"

# 2. 上传
echo "▸ 上传中…"
scp "${TARBALL}" "${TARGET}:/tmp/"

# 3. 远程部署
echo "▸ 远程部署中…"
ssh "${TARGET}" bash -s <<REMOTE
set -euo pipefail
REMOTE_DIR="${REMOTE_DIR}"
TARBALL="${TARBALL}"

sudo mkdir -p "\${REMOTE_DIR}"
sudo tar xzf "\${TARBALL}" -C "\${REMOTE_DIR}"
sudo chown -R \$USER:\$USER "\${REMOTE_DIR}"
rm -f "\${TARBALL}"

cd "\${REMOTE_DIR}"

# 依赖检查
if ! command -v node >/dev/null 2>&1; then
  echo "  ! 未检测到 node，请先安装 Node.js 20+"
  exit 1
fi

if [ ! -d node_modules/playwright ]; then
  echo "  · 安装 Playwright…"
  npm init -y >/dev/null 2>&1
  npm install playwright >/dev/null 2>&1
  npx playwright install --with-deps chromium >/dev/null 2>&1 || \
    npx playwright install chromium >/dev/null 2>&1
fi

# 首次抓取
if [ ! -f data/events.json ] || [ "\${FORCE_FETCH:-0}" = "1" ]; then
  echo "  · 首次抓取数据…"
  NODE_PATH=./node_modules node fetcher/update.js --refresh || echo "  ! 抓取失败，可稍后手动重试"
fi

# systemd 服务
if command -v systemctl >/dev/null 2>&1; then
  PORT=\${PORT:-8080}
  sudo tee /etc/systemd/system/aimap.service >/dev/null <<EOF
[Unit]
Description=AI Event Map
After=network.target

[Service]
WorkingDirectory=\${REMOTE_DIR}
ExecStart=/usr/bin/python3 -m http.server \${PORT} --bind 0.0.0.0
Restart=always
User=\$(whoami)

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now aimap
  echo "  ✓ 服务已启动（端口 \${PORT}）"
else
  echo "  ! 无 systemctl，请手动启动: cd \${REMOTE_DIR} && python3 -m http.server 8080 --bind 0.0.0.0"
fi

# 定时任务
if [ "\${SETUP_CRON:-1}" = "1" ] && command -v crontab >/dev/null 2>&1; then
  CRON_LINE="7 9 * * * cd \${REMOTE_DIR} && NODE_PATH=./node_modules node fetcher/update.js --refresh >> \${REMOTE_DIR}/cron.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v 'ai-map\|fetcher/update.js' || true; echo "\${CRON_LINE}" ) | crontab -
  echo "  ✓ 定时任务已配置（每天 09:07）"
fi

echo ""
echo "✓ 部署完成"
echo "  目录: \${REMOTE_DIR}"
echo "  日志: \${REMOTE_DIR}/cron.log"
echo ""
echo "接下来配置 Nginx 反向代理并申请 HTTPS 证书，详见 deploy/README.md"
REMOTE

rm -f "${TARBALL}"
echo "▸ 完成"
