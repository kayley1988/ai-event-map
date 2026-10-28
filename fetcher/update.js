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

  // 统计
  const byCity = {};
  const byType = {};
  for (const e of events) {
    byCity[e.city] = (byCity[e.city] || 0) + 1;
    byType[e.type] = (byType[e.type] || 0) + 1;
  }

  // 清理过期活动（已结束超过 30 天）
  const cutoff = new Date(Date.now() - 864e5 * 30).toISOString().slice(0, 10);
  const alive = events.filter((e) => (e.dateEnd || e.dateStart) >= cutoff);

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

  // 1. HTTP 管线
  run(path.join(__dirname, 'fetch.js'), refresh ? ['--refresh'] : []);

  // 2. 浏览器管线（CI 里可用 --skip xhs,douyin 跳过需登录的平台）
  if (!httpOnly) {
    const bArgs = skip ? ['--skip', skip] : [];
    const r = run(path.join(__dirname, 'browser-fetch.js'), bArgs);
    if (r) run(path.join(__dirname, 'merge-browser.js'));
  }

  // 3. 聚合站
  run(path.join(__dirname, 'competition-radar.js'));

  // 4. 快照
  buildSnapshot();
  console.log('\n════ 更新完成 ════');
}

main();
