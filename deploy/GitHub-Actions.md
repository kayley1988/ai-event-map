# GitHub Actions 自动抓取 + 自动部署

一条流水线搞定：**每周一北京时间 09:01 自动抓取 → 提交数据 → 重新部署站点**，
GitHub 全托管，电脑不用开机，0 元成本。

---

## 一、这套配置已经在本地做完了

| 文件 | 作用 |
|---|---|
| `.github/workflows/update-and-deploy.yml` | 定时抓取 + 构建 + 部署 Pages |
| `package.json` | 声明 playwright 依赖，CI 里 `npm install` 用 |
| `.gitignore` | 已排除 `data/.cache`、`data/auth`、`data/browser-out`、`node_modules`、`dist` |

代码已经 `git init` 并提交好了，**你只需要建仓库 + push**。

---

## 二、你会剩下 3 步手动操作（约 3 分钟）

### 1. 在 GitHub 建一个空仓库

打开 https://github.com/new
- Repository name：`ai-event-map`
- 选 **Public**（Pages 免费，公开仓库 Actions 分钟数不限）
- **不要**勾选 README / .gitignore / license（保持空仓库）

### 2. 本地 push

在本目录（`site/`）执行，把 `你的用户名` 换成实际值：

```bash
git remote add origin https://github.com/你的用户名/ai-event-map.git
git push -u origin main
```

首次 push 会弹浏览器让你授权 GitHub 账号，授权一次即可。
如果 Windows 弹的是 `Git Credential Manager` 窗口，点 `Sign in with your browser`。

### 3. 打开 Pages

仓库 → **Settings → Pages** → Build and deployment 的 **Source 选 `GitHub Actions`**

（不要选 "Deploy from a branch"，我们走的是 actions 部署）

完成后你的站点地址是：

```
https://你的用户名.github.io/ai-event-map/
```

推送成功后第一次部署会自动开始，约 1 分钟出结果。

---

## 三、日常怎么用

| 想做什么 | 怎么做 |
|---|---|
| 看抓取有没有成功 | 仓库 **Actions** 标签页，绿色勾=成功 |
| 立刻手动跑一次 | Actions → 左侧「抓取数据并部署」→ 右侧 **Run workflow** |
| 只改页面不改数据 | 直接 push，只走部署不抓取（省 3 分钟） |
| 看抓取日志 | 点进某次运行 → `抓取最新活动` 步骤展开 |

**调度时间**：`cron: '1 1 * * 1'`
GitHub 的 cron 是 **UTC**，`01:01 UTC` = **北京时间 09:01**。
故意错开整点，因为 UTC 00:00 是全世界定时任务高峰，会延迟 5~30 分钟。

---

## 四、CI 里跑什么、不跑什么

| 数据源 | CI 里跑 | 原因 |
|---|---|---|
| 必应搜索 | ✅ | 纯 HTTP |
| 搜狗微信 | ✅ | 纯 HTTP |
| RSS（InfoQ / 掘金 / 机器之心） | ✅ | 纯 HTTP |
| 活动行 | ✅ | Playwright 免登录可抓，是主力来源 |
| B 站 | ✅ | 免登录 |
| AI Competition Radar | ✅ | 解析页面 flight 数据 |
| 小红书 | ❌ 跳过 | 需扫码登录态 |
| 抖音 | ❌ 跳过 | 需扫码登录态 |

所以 workflow 里写的是 `node fetcher/update.js --skip xhs,douyin`。

### 想连小红书/抖音一起抓？

小红书/抖音的登录态是浏览器 cookie，CI 每次都是干净环境，必须靠 Secret 还原：

1. 本地先登录一次，生成 `data/auth/xhs.json`
   ```bash
   node fetcher/browser-fetch.js --platform xhs --login
   ```
2. 复制文件内容，存到仓库 **Settings → Secrets and variables → Actions → New repository secret**
   - Name：`XHS_AUTH`
   - Secret：`xhs.json` 的完整内容
3. 在 workflow 的「抓取最新活动」步骤前加：
   ```yaml
       - name: 还原小红书登录态
         if: github.event_name != 'push'
         env:
           XHS_AUTH: ${{ secrets.XHS_AUTH }}
         run: |
           mkdir -p data/auth
           printf '%s' "$XHS_AUTH" > data/auth/xhs.json
   ```
4. 把 `--skip xhs,douyin` 里的 `xhs` 去掉

> ⚠️ 登录态 = 你的账号凭据。cookie 通常 30 天左右失效，过期后要重新生成并更新 Secret。
> 公开仓库建议不要放，被截图/转发就泄露了。

---

## 五、常见问题

**Q：Actions 报 `Resource not accessible by integration`**
Settings → Actions → General → Workflow permissions 选 **Read and write permissions**，
并勾上 `Allow GitHub Actions to create and approve pull requests`。

**Q：部署成功但页面 404**
Settings → Pages 的 Source 必须是 `GitHub Actions`。选成 branch 就会出现空页面。

**Q：数据没更新，但 Actions 是绿的**
看「提交数据变更」日志里有没有「数据无变化」。可能是抓取步骤失败了
（`continue-on-error: true` 会让它不报错），展开「抓取最新活动」看具体报错。

**Q：抓取步骤超时**
`timeout-minutes: 45`，正常耗时 4~8 分钟（含 Playwright 安装）。
如果经常接近上限，把 `--skip` 加上 `bilibili`。

**Q：能不能部署到 Vercel / Cloudflare Pages？**
可以，把 workflow 里「打包静态站点 / 配置 Pages / 上传 / 部署」四步删掉，
换成对应平台的 deploy action，或者直接让平台监听仓库 push。
现在默认用 Pages 是因为**不需要任何额外账号和 token**。

---

## 六、和 WorkBuddy 定时任务的关系

两条路可以并存，也可以只留一条：

| | WorkBuddy 定时任务 | GitHub Actions |
|---|---|---|
| 触发 | 本机每天 9:00 | GitHub 云端每天 9:01 |
| 需要开机 | 需要 | 不需要 |
| 需要登录态 | 有（共享本机浏览器 cookie） | 无 |
| 部署 | 手动发布 | 自动 |

建议：**以 GitHub Actions 为主**（无人值守），
本机 WorkBuddy 定时任务留着，用于需要登录态的小红书/抖音补充抓取。
