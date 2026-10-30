/**
 * OPC 圈活动采集（opcquan.com/activities）
 * ------------------------------------------------------------
 * 站点是 Next.js SSR：活动卡片直接渲染在 HTML 的 <a> 卡片里，
 * 无需登录、无接口签名，用浏览器渲染后遍历 DOM 即可全量取回。
 *
 * 卡片结构（每张卡一个 a[class*=rounded-2xl]）：
 *   [emoji] / 来源名（OPC圈|活动行|活动）+ 分类 / 标题 / "11月7日开始" / 城市 / 去报名
 *
 * 产出：data/browser-out/opcquan.json（结构与 raw.json 同构，供 merge-browser 合并）
 *
 * 运行：node fetcher/collect-opcquan.js
 *      node fetcher/collect-opcquan.js --max-scroll 60   # 默认 40
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'browser-out');
const OUT = path.join(OUT_DIR, 'opcquan.json');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const MAX_SCROLL = Number(arg('max-scroll', 40));

/** 站点来源标识 → 友好名 */
function sourceName(href) {
  if (/huodongxing\.com/.test(href)) return '活动行';
  if (/mp\.weixin\.qq\.com/.test(href)) return '公众号';
  if (/xiaohongshu\.com/.test(href)) return '小红书';
  if (/huaweicloud/.test(href)) return '华为云';
  if (/modelscope/.test(href)) return 'ModelScope';
  if (/gitcode/.test(href)) return 'GitCode';
  if (/saikr/.test(href)) return '赛氪';
  try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return 'OPC圈'; }
}

/** 明显不是活动标题的占位文本 */
const PLAIN_TITLE = new Set(['AI赛事通', '线上活动', '活动行', 'OPC圈', '活动', '更多', '去报名']);

/**
 * 站点的分类标签（卡片第 2 行），与「标题」严格区分。
 * 这些词本身不是活动名，若被当成标题会让条目失去可读性。
 */
const CATEGORY_LABELS = new Set([
  '大会/峰会', '沙龙/交流', '黑客松/竞赛', '培训/工作坊',
  '展览/展会', '路演/投融资', '活动', '发布会', '赛事',
]);

/** 与 AI / 科技创业无关的品类，站点里混有少量这类活动，入站即丢弃 */
const OFF_TOPIC = [
  '短剧', '美妆', '护肤', '医美', '养生', '艾灸', '餐饮', '美食', '烘焙', '调酒',
  '婚礼', '相亲', '亲子', '宠物', '瑜伽', '塔罗', '占星', '化妆', '美甲', '发型',
  '房产', '家装', '装修', '汽车', '车展', '酒展', '茶艺', '古琴', '书法',
];

/**
 * 卡片文本行 → 字段
 *
 * 站点的卡片结构是固定的（按 DOM 顺序）：
 *   [来源徽章] [分类标签] [活动标题] [日期行] [城市行]
 * 例：["活动行","大会/峰会","泛微·300+AI应用场景体验大会—10月30日绍兴站","10月30日开始","绍兴 · 浙江绍兴"]
 *
 * 早期版本用「找最长的分类样式行」之类模糊正则来猜标题，结果：
 *   标题里带「·」或「省」时（如「泛微·300+AI…—10月30日绍兴站」）会被误当成城市行，
 *   真正的标题反而退化成「大会/峰会」这种分类词。
 * 现在改为按位置解析：先定位日期行，标题取它紧邻的上一行。
 */
function parseCard(card) {
  const lines = card.lines.filter((l) => l && l !== '去报名');
  if (lines.length < 3) return null;

  // 1) 日期行：站点固定写作「10月30日开始」/「10月30日截止」
  let dateIdx = -1;
  let dateText = '';
  let dateKind = '';
  for (let i = 2; i < lines.length; i++) {
    const m = lines[i].match(/^(\d{1,2})月(\d{1,2})日\s*(开始|截止)?$/);
    if (m) {
      dateIdx = i;
      dateText = `${+m[1]}月${+m[2]}日`;
      dateKind = m[3] || '';
      break;
    }
  }
  if (dateIdx < 0) return null;   // 没有日期行 → 无法定位标题，丢弃

  // 2) 标题 = 日期行紧邻的上一行（跳过分类标签行）
  let titleIdx = dateIdx - 1;
  while (titleIdx >= 0 && CATEGORY_LABELS.has(lines[titleIdx])) titleIdx--;
  const title = (lines[titleIdx] || '').trim();
  if (!title || titleIdx < 1) return null;

  // 3) 分类标签：标题之前最近的分类词
  let category = '';
  for (let i = titleIdx - 1; i >= 0; i--) {
    if (CATEGORY_LABELS.has(lines[i])) { category = lines[i]; break; }
  }

  // 4) 城市行 = 日期行之后的一行；「城市 · 省市城市」取前半段
  const cityLine = (lines[dateIdx + 1] || '').trim();
  let city = '';
  if (cityLine) {
    city = cityLine.split('·')[0].trim();
    if (!/线上/.test(city) && !city) city = cityLine;
  }

  // 兜底卡（只有「AI赛事通」这类来源占位、没有真实标题）直接丢弃
  if (!title || PLAIN_TITLE.has(title) || CATEGORY_LABELS.has(title)) return null;
  // OPC 圈里混着的明显非科技类活动（短剧/美妆/餐饮等）丢弃
  if (OFF_TOPIC.some((k) => title.includes(k))) return null;

  // 去掉标题里残留的来源/分类前缀（少数卡片把多段拼在一行）
  const cleanTitle = title.replace(/^(活动行|OPC圈|活动|AI赛事通)\s*[｜|]\s*/, '')
    .replace(/^(大会\/峰会|沙龙\/交流|培训\/工作坊|展览\/展会|路演\/投融资|黑客松\/竞赛)\s*[｜|]\s*/, '')
    .replace(/^\d+月\d+日(开始)?\s*[｜|]\s*/, '')
    .trim();
  if (!cleanTitle || cleanTitle.length < 4) return null;

  return {
    title: cleanTitle,
    dateText,
    // 「截止」表示报名/提交截止日，活动当天未知，按站点展示的日期落点
    dateKind,
    city: (/线上/.test(city) ? '线上活动' : city),
    category,
    href: card.href,
  };
}

/** OPC 卡片分类 → 我方活动类型（站点分类比标题猜测准确得多） */
function mapType(category, title) {
  const c = category || '';
  if (/黑客松|竞赛|Hackathon/i.test(c + title)) return 'hackathon';
  if (/沙龙|交流/.test(c)) return 'salon';
  if (/培训|工作坊/.test(c)) return 'salon';
  if (/路演|投融资/.test(c)) return 'meetup';
  if (/大会|峰会|展览|展会/.test(c)) return 'conference';
  // 分类只有笼统的「活动」时才回落到标题
  if (/黑客松|hackathon|竞赛|大赛|挑战赛/i.test(title)) return 'hackathon';
  if (/沙龙|分享会|交流会|茶话|下午茶|闭门/i.test(title)) return 'salon';
  if (/路演|投融资|demo\s*day/i.test(title)) return 'meetup';
  if (/社区|同行社|meetup|聚会/.test(title)) return 'meetup';
  return 'conference';
}

async function main() {
  console.log('════ OPC 圈活动采集 ════');
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  page.setDefaultTimeout(60000);

  await page.goto('https://www.opcquan.com/activities', { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(2500);

  const total = await page.evaluate(() => {
    const m = document.body.innerText.match(/(\d+)\s*场活动/);
    return m ? Number(m[1]) : 0;
  });
  console.log(`  站点自报活动数：${total}`);

  // 滚动触发加载，直到数量稳定
  let prev = 0;
  for (let i = 0; i < MAX_SCROLL; i++) {
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(600);
    const n = await page.evaluate(() => document.querySelectorAll('a[class*="rounded-2xl"][href]').length);
    if (n === prev && i > 4) break;
    prev = n;
  }
  console.log(`  DOM 卡片数：${prev}`);

  const cards = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a[class*="rounded-2xl"][href]').forEach((a) => {
      const lines = (a.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
      if (lines.length >= 4) out.push({ href: a.href, lines });
    });
    return out;
  });

  const seen = new Set();
  const results = [];
  for (const c of cards) {
    const p = parseCard(c);
    if (!p) continue;
    const key = p.href || `${p.title}|${p.dateText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // 日期分「开始」与「截止」两种：截止日是报名/投稿节点，不是活动当天。
    // 站点卡片只给一个日期，这里如实保留其语义，摘要层再据此生成文案。
    const dateLabel = p.dateText + (p.dateKind === '截止' ? '截止' : '开始');
    results.push({
      platform: 'opcquan',
      platformName: `OPC圈 · ${sourceName(p.href)}`,
      title: p.title,
      type: mapType(p.category, p.title),
      category: p.category,
      desc: [p.title, dateLabel, p.city].filter(Boolean).join('｜'),
      dateText: p.dateText,
      dateKind: p.dateKind,
      city: p.city,
      url: p.href,
      host: 'OPC圈',
    });
  }

  await browser.close();

  if (!results.length) {
    console.log('✗ 未解析到活动，页面结构可能已变');
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), results: { opcquan: results } }, null, 1), 'utf8');
  console.log(`  ✔ 解析 ${results.length} 条 → ${path.relative(ROOT, OUT)}`);

  const bySrc = {};
  for (const r of results) bySrc[r.platformName] = (bySrc[r.platformName] || 0) + 1;
  console.log('  来源分布:', Object.entries(bySrc).map(([k, v]) => `${k}:${v}`).join(' '));
}

main().catch((e) => {
  console.error('✗ OPC 圈采集失败:', e.message);
  process.exit(1);
});
