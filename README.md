# AI 活动地图

全国 AI 黑客松 / 开发者大会 / 技术峰会的实时更新地图。

**🔗 线上地址：<https://kayley1988.github.io/ai-event-map/>**
（每天 09:01 自动抓取更新，由 GitHub Actions 全自动维护，见 `deploy/GitHub-Actions.md`）

- **全国地图**：点击城市查看当地活动
- **倒排日历**：按日期倒序排列，标注 D-N 剩余天数
- **我的关注**：收藏活动 + 自定义倒计时（保存在本地浏览器）

## 目录结构

```
site/
├── index.html              # 主页面（单页应用）
├── assets/
│   ├── style.css           # 样式（海报风视觉）
│   └── app.js              # 应用逻辑
├── data/
│   ├── events.json         # ★ 活动数据（定时任务更新此文件）
│   ├── articles.json       # AI 资讯文章流（资讯页数据）
│   ├── seed-events.json    # 种子数据（人工维护的高质量活动）
│   ├── map-paths.js        # 地图路径（自动生成）
│   ├── china_100000_full.json  # 标准国界源数据
│   └── auth/               # 平台登录态（本地保存，不上传）
└── fetcher/
    ├── update.js           # ★ 统一入口（定时任务调用）
    ├── fetch.js            # HTTP 管线：必应/搜狗微信/RSS
    ├── browser-fetch.js    # 浏览器管线：活动行/B站/小红书/抖音
    ├── competition-radar.js# 聚合站：AI Competition Radar
    ├── collect-articles.js # AI 资讯文章流（ClawHunt 官方文章 + RSS 媒体）
    ├── detail-browser.js   # 浏览器补正文（详情页全文回源）
    ├── merge-browser.js    # 浏览器结果 → 结构化活动
    ├── parsers.js          # 字段识别规则（共用）
    ├── sources.js          # 数据源配置
    ├── build-map.js        # GeoJSON → SVG path
    ├── probe.js            # DOM 结构探查工具
    └── check.js            # 页面自检
```

## 数据管线

```
update.js
  ├─ fetch.js ──────────────→ HTTP 抓取
  │    ├─ 必应搜索（AI 黑客松/大会/小红书/抖音 站内）
  │    ├─ 搜狗微信搜索（公众号文章）
  │    └─ RSS（InfoQ / 少数派 / 人人都是产品经理 / 机器之心）
  │
  ├─ browser-fetch.js ──────→ 浏览器渲染抓取
  │    ├─ 活动行（线下活动聚合，需搜索交互）
  │    ├─ B站搜索
  │    └─ 小红书 / 抖音（需登录态）
  │         ↓
  │    merge-browser.js → 结构化活动
  │
  ├─ competition-radar.js ─→ 全球 AI 赛事聚合站
  │
  └─ 合并去重 → data/events.json
```

## 常用命令

```bash
# 完整更新（浏览器 + HTTP），约 3-5 分钟
node fetcher/update.js --refresh

# 只跑 HTTP（快，约 1 分钟，不启动浏览器）
node fetcher/update.js --http-only

# 单独跑某个平台
node fetcher/browser-fetch.js --platform huodongxing

# 重新生成地图路径（改了 GeoJSON 后）
node fetcher/build-map.js

# 页面自检 + 截图
node fetcher/check.js
```

环境变量（Windows）：
```bash
set NODE_PATH=C:/Users/zhouqian/.workbuddy/binaries/node/workspace/node_modules
```

## 登录态（小红书 / 抖音）

这两个平台有登录墙，首次使用需手动扫码登录一次：

```bash
node fetcher/browser-fetch.js --platform xhs --login
```

浏览器会打开，按提示扫码登录，登录后回到终端按 Enter 保存。
登录态保存在 `data/auth/<平台>.json`，仅本机使用，不会上传。

## 新增数据源

编辑 `fetcher/sources.js`，在 `SOURCES` 数组加一项即可：

```js
{
  id: 'my-source',
  name: '我的数据源',
  type: 'search',        // 'search' | 'wechat' | 'rss'
  url: 'https://.../?q={q}',
  queries: ['关键词1', '关键词2'],
  weight: 3,            // 权重，影响初筛优先级
}
```

若需新增解析器，在 `fetch.js` 的 `parseXxx()` 中实现对应函数。

## 人工补充高质量活动

编辑 `data/seed-events.json`，添加活动对象。种子数据优先级高于自动抓取，
适合放确定要展示的活动（如海报上的官方活动）。

## 合规说明

- 地图边界使用标准行政区划数据（DataV GeoAtlas），含完整国界、台湾省与南海诸岛九段线
- 只采集公开可访问的内容，不绕过验证码或访问控制
- 登录态仅保存在本机，不上传任何服务器
- 位置数据仅为城市级公开信息，不涉及个人位置

## 定时任务

两条链路并行，互为备份：

**1. GitHub Actions（推荐，无需开机）**

`.github/workflows/update-and-deploy.yml`，每天北京时间 09:01
（UTC `cron: '1 1 * * *'`）自动执行：

```
npm install playwright → node fetcher/update.js --skip xhs,douyin
  → git commit data/events.json → 打包 dist → 部署 GitHub Pages
```

CI 环境没有登录态，所以跳过小红书/抖音；活动行、B站、必应、搜狗微信、
RSS、赛事雷达全部照跑。任何触发方式（定时/手动/push）都会走部署。

部署步骤见 `deploy/GitHub-Actions.md`。

**2. WorkBuddy 定时任务（本机）**

「AI 活动数据每日抓取」，每天 09:00 执行 `fetcher/update.js --refresh`，
带本机浏览器登录态，可抓小红书/抖音，用于补充 CI 拿不到的数据。
