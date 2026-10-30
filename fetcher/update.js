/**
 * 统一更新入口（定时任务调用这个）
 * ------------------------------------------------------------
 * 依次执行：
 *   1. HTTP 管线：必应搜索 + 搜狗微信 + RSS → events.json
 *   2. 浏览器管线：活动行 / B站 / 小红书 / 抖音 → 合并进 events.json
 *   3. 聚合站管线：AI Competition Radar
 *   4. 生成站点数据快照 site/data/events.json + 统计信息
 *
 * 用法：
 *   node fetcher/update.js              # 完整更新（浏览器+HTTP）
 *   node fetcher/update.js --http-only  # 只跑 HTTP（不启动浏览器，快）
 *   node fetcher/update.js --refresh    # 忽略缓存，强制重新抓
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const has = (f) => process.argv.includes(f);

/** 取 `--skip a,b` 的值 */
function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
}

/**
 * playwright 可能装在三个位置，按优先级找第一个存在的：
 *   1. 环境变量 NODE_PATH（CI 里显式指定）
 *   2. 项目内 node_modules（npm install 后）
 *   3. WorkBuddy 托管运行时（本地开发机）
 */
const NODE_PATH = [
  process.env.NODE_PATH,
  path.join(ROOT, 'node_modules'),
  'C:/Users/zhouqian/.workbuddy/binaries/node/workspace/node_modules',
].filter(Boolean).find((p) => fs.existsSync(p)) || path.join(ROOT, 'node_modules');

function run(script, args = []) {
  const cmd = [script, ...args];
  console.log(`\n$ node ${path.relative(ROOT, script)} ${args.join(' ')}`);
  try {
    const out = execFileSync(NODE, cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15 * 60 * 1000,
      env: {
        ...process.env,
        NODE_PATH,
      },
    });
    console.log(out.trim());
    return true;
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    console.log(out.trim().split('\n').slice(-12).join('\n'));
    console.log('  (该步骤失败，继续执行下一步)');
    return false;
  }
}

function buildSnapshot() {
  const src = path.join(ROOT, 'data', 'events.json');
  if (!fs.existsSync(src)) return;
  const db = JSON.parse(fs.readFileSync(src, 'utf8'));
  const events = db.events || [];

  // 补齐 summary / highlights（种子数据可能没有）
  const { buildSummary, extractHighlights } = require('./parsers');
  for (const e of events) {
    if (!e.summary) e.summary = buildSummary(e);
    if (!e.highlights) e.highlights = extractHighlights(`${e.desc || ''}`);
    if (e.summary && e.summary.length > 150) e.summary = e.summary.slice(0, 150) + '…';
  }

  // 清理过期活动（已结束超过 30 天）+ 回源确认已结束的活动
  const cutoff = new Date(Date.now() - 864e5 * 30).toISOString().slice(0, 10);
  const alive = events.filter((e) => !e.stale && (e.dateEnd || e.dateStart) >= cutoff);

  // 统计必须基于最终保留的条目，否则 byCity/byType 会包含已剔除的活动，
  // 与 events 数组对不上（前端按城市计数展示时会不一致）
  const byCity = {};
  const byType = {};
  for (const e of alive) {
    byCity[e.city] = (byCity[e.city] || 0) + 1;
    byType[e.type] = (byType[e.type] || 0) + 1;
  }

  const out = {
    updatedAt: new Date().toISOString(),
    total: alive.length,
    byCity,
    byType,
    cities: Object.keys(byCity).sort((a, b) => byCity[b] - byCity[a]),
    events: alive,
  };
  fs.writeFileSync(src, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n✔ 数据快照已更新：${alive.length} 条活动，${Object.keys(byCity).length} 个城市`);
  console.log('  城市分布:', Object.entries(byCity).map(([c, n]) => `${c}${n}`).join(' '));
}

function main() {
  console.log('════ 全国 AI 活动数据更新 ════');
  console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);

  const refresh = has('--refresh');
  const httpOnly = has('--http-only');
  const skip = arg('skip', '');

  // --snapshot-only：只重建统计快照（不抓取），用于人工修正数据后刷新统计字段
  if (has('--snapshot-only')) {
    buildSnapshot();
    console.log('\n════ 快照已重建 ════');
    return;
  }

  // 1. HTTP 管线
  run(path.join(__dirname, 'fetch.js'), refresh ? ['--refresh'] : []);

  // 2. 聚合站（必须早于 merge-browser：merge-browser 会读取 radar.json）
  run(path.join(__dirname, 'competition-radar.js'));

  // 2.5 OPC 圈（opcquan.com/activities）：500+ 场 AI/OPC 社区活动，
  //     Next.js SSR 直出卡片，无需登录；失败不影响主链路
  if (!httpOnly) run(path.join(__dirname, 'collect-opcquan.js'));

  // 3. 浏览器管线（CI 里可用 --skip xhs,douyin 跳过需登录的平台）
  if (!httpOnly) {
    const bArgs = skip ? ['--skip', skip] : [];
    const r = run(path.join(__dirname, 'browser-fetch.js'), bArgs);
    // merge-browser 同时合并 raw.json 与 radar.json
    if (r) run(path.join(__dirname, 'merge-browser.js'));
    // 3.5 浏览器补正文：对缺全文的活动回源渲染页面
    run(path.join(__dirname, 'detail-browser.js'));
  } else {
    // --http-only：不启动浏览器，但仍要把 radar.json 并入（只并雷达源，避免引入过期 raw.json）
    run(path.join(__dirname, 'merge-browser.js'), ['--radar-only']);
  }

  // 3.5 AI 资讯文章流（ClawHunt 官方文章 + RSS 媒体）
  //     36氪 反爬需浏览器渲染，先用独立采集器产出，再由 collect-articles 读取
  if (!httpOnly) run(path.join(__dirname, 'collect-36kr.js'));
  run(path.join(__dirname, 'collect-articles.js'));

  // 4. 快照
  buildSnapshot();

  // 5. 静态资源指纹：把 index.html 里的 ?v=xxx 更新为资源内容哈希
  //    否则 GitHub Pages 的 max-age=600 会让浏览器继续用旧 app.js，
  //    旧 JS 解析新数据时可能渲染异常（例如资讯页空白）
  stampAssets();

  console.log('\n════ 更新完成 ════');
}

/** 计算 assets 下 css/js 的内容哈希，回写 index.html 的 ?v= 参数 */
function stampAssets() {
  const crypto = require('crypto');
  const htmlPath = path.join(ROOT, 'index.html');
  if (!fs.existsSync(htmlPath)) return;
  let html = fs.readFileSync(htmlPath, 'utf8');
  let touched = 0;
  for (const rel of ['assets/style.css', 'assets/app.js']) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const hash = crypto.createHash('md5').update(fs.readFileSync(abs)).digest('hex').slice(0, 8);
    const re = new RegExp(`${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\?v=[a-f0-9]{8})?`, 'g');
    const next = html.replace(re, `${rel}?v=${hash}`);
    if (next !== html) { html = next; touched++; }
  }
  if (touched) {
    fs.writeFileSync(htmlPath, html);
    console.log(`\n$ stamp assets: ${touched} 个资源指纹已更新`);
  }
}

main();
