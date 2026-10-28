# 部署到自己的服务器

把抓取脚本放到服务器上跑，数据更新后自动同步到线上站点。
这样电脑关机也不影响数据新鲜度。

## 方案 A：一台服务器同时跑抓取 + 站点（推荐）

```
用户浏览器
   ↓
你的服务器 (Nginx 反代 → Python http.server)
   ├─ 站点静态文件
   └─ cron 每天跑 fetcher/update.js
```

### 1. 上传代码

```bash
# 本地打包（排除缓存与登录态）
cd C:/Users/zhouqian/WorkBuddy/2026-10-28-09-14-44
tar --exclude='site/data/.cache' \
    --exclude='site/data/auth' \
    --exclude='site/data/browser-out' \
    --exclude='site/shots' \
    -czf ai-map.tar.gz site/
```

```bash
# 服务器上解压
ssh user@your-server 'mkdir -p ~/ai-map && tar xzf ai-map.tar.gz -C ~/ai-map'
```

### 2. 服务器装依赖

```bash
ssh user@your-server
cd ~/ai-map/site

# Node（抓取用）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Playwright（浏览器抓取用）
npm init -y && npm install playwright
npx playwright install --with-deps chromium

# Python（静态站点服务）
sudo apt install -y python3
```

### 3. 配定时任务

```bash
crontab -e
```

加一行（每天 9:07 抓取，避开整点）：

```cron
7 9 * * * cd ~/ai-map/site && NODE_PATH=./node_modules /usr/bin/node fetcher/update.js --refresh >> ~/ai-map/cron.log 2>&1
```

> 首次跑建议手动执行一次 `node fetcher/update.js --refresh` 确认无报错。

### 4. 启动站点

```bash
cd ~/ai-map/site
PORT=8080 python3 -m http.server $PORT --bind 0.0.0.0
```

用 systemd 常驻：

```bash
sudo tee /etc/systemd/system/aimap.service > /dev/null <<'EOF'
[Unit]
Description=AI Event Map
After=network.target

[Service]
WorkingDirectory=/home/user/ai-map/site
ExecStart=/usr/bin/python3 -m http.server 8080 --bind 0.0.0.0
Restart=always
User=user

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now aimap
```

### 5. Nginx 反代 + HTTPS

```nginx
server {
    listen 443 ssl http2;
    server_name ai.example.com;

    ssl_certificate     /etc/letsencrypt/live/ai.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ai.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 方案 B：已有网站，只加一个抓取任务

如果你的站点已经部署好了（比如在 Vercel / 对象存储 / GitHub Pages），
只需要在任意一台小机器上跑抓取，然后 push 数据文件。

```bash
# 抓取后提交数据
cd ~/ai-map/site
node fetcher/update.js --refresh
git add data/events.json
git commit -m "chore: update events $(date +%F)"
git push
```

CI 配了自动部署的话，数据一 push 线上就更新了。

## 小红书 / 抖音登录态怎么迁到服务器

在本地登录一次，把 `data/auth/*.json` 复制到服务器（**注意这是敏感文件，含登录 Cookie**）：

```bash
scp data/auth/xhs.json user@your-server:~/ai-map/site/data/auth/
chmod 600 ~/ai-map/site/data/auth/*.json
```

或者更安全的方式：服务器上直接跑一次登录流程：

```bash
cd ~/ai-map/site
node fetcher/browser-fetch.js --platform xhs --login
```

服务器上没有图形界面，用 SSH X11 转发或 VNC 更方便。

## 常见问题

**抓取不到数据？**
看 `~/ai-map/cron.log`。常见原因：
- 服务器 IP 被目标站点限流 → 加 `sleep` 或降低频率
- Chromium 缺依赖 → `npx playwright install --with-deps chromium`
- 磁盘空间不足 → Playwright 浏览器约占 500MB

**数据更新了但网站没变？**
浏览器缓存。给 `events.json` 加版本号参数即可（前端已带 `?t=timestamp`）。

**想加新数据源？**
编辑 `fetcher/sources.js`，加一个配置对象，重跑即可。详见项目根目录 README。
