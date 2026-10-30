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

/** 与 AI / 科技创业无关的品类，站点里混有少量这类活动，入站即丢弃 */
const OFF_TOPIC = [
  '短剧', '美妆', '护肤', '医美', '养生', '艾灸', '餐饮', '美食', '烘焙', '调酒',
  '婚礼', '相亲', '亲子', '宠物', '瑜伽', '塔罗', '占星', '化妆', '美甲', '发型',
  '房产', '家装', '装修', '汽车', '车展', '酒展', '茶艺', '古琴', '书法',
];

/**
 * 卡片文本行 → 字段
 * 例：["🏛️","OPC圈","培训/工作坊","【OPC 商业变现】…","11月7日开始","杭州","去报名"]
 */
function parseCard(card) {
  const lines = card.lines.filter((l) => l && l !== '去报名');
  if (lines.length < 3) return null;

  const isDate = (l) => /^(\d+月\d+日|\d{4}-\d{2}-\d{2})/.test(l) && /开始|结束|至|—|-/.test(l);
  const dateText = lines.find(isDate) || '';
  const cityText = lines.find((l) => /线上活动|线上$|·|市$|省/.test(l) && !isDate(l)) || '';
  const cat = lines.find((l) => /大会|峰会|黑客松|竞赛|沙龙|交流|培训|工作坊|展览|展会|路演|投融资|活动/.test(l) && l.length < 14) || '';

  // 标题：排除来源名、emoji、分类、日期、城市后的最长行
  const skip = new Set([dateText, cityText, cat]);
  // 城市行常是「杭州 · 浙江杭州」这种「城市 · 省市城市」，把两段都列为排除项
  if (cityText) cityText.split('·').forEach((s) => skip.add(s.trim()));
  const cands = lines.filter((l) =>
    !skip.has(l)
    && !isDate(l)                       // 日期行不能当标题
    && !/^[\u4e00-\u9fa5]{2,8}\s*[·丨|]\s*[\u4e00-\u9fa5]{2,10}$/.test(l)  // 纯「城市 · 城市」行
    && /^[\u4e00-\u9fa5a-zA-Z0-9（(【[]/.test(l)   // 必须以文字开头（排除纯 emoji）
    && l.replace(/[^\u4e00-\u9fa5a-z0-9]/gi, '').length >= 4);
  const title = cands.sort((a, b) => b.length - a.length)[0] || '';
  // 兜底卡（只有「AI赛事通」这类来源占位、没有真实标题）直接丢弃
  if (!title || PLAIN_TITLE.has(title)) return null;
  // OPC 圈里混着的明显非科技类活动（短剧/美妆/餐饮等）丢弃
  if (OFF_TOPIC.some((k) => title.includes(k))) return null;
  // 卡片偶尔把「活动行｜大会/峰会｜10月30日开始｜…」整串塞进标题行，剥掉前缀
  const cleanTitle = title.replace(/^(活动行|OPC圈|活动)\s*[｜|]\s*/, '')
    .replace(/^(大会\/峰会|沙龙\/交流|培训\/工作坊|展览\/展会|路演\/投融资|黑客松\/竞赛|活动)\s*[｜|]\s*/, '')
    .replace(/^\d+月\d+日(开始)?\s*[｜|]\s*/, '')
    .trim();
  if (!cleanTitle || cleanTitle.length < 4) return null;

  return {
    title: cleanTitle,
    dateText: dateText.replace(/开始$|结束$/, '').trim(),
    city: (/线上/.test(cityText) ? '线上活动' : cityText.split('·').pop().trim()),
    category: cat,
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
    results.push({
      platform: 'opcquan',
      platformName: `OPC圈 · ${sourceName(p.href)}`,
      title: p.title,
      type: mapType(p.category, p.title),
      desc: [p.category, p.title, p.dateText && `${p.dateText}开始`, p.city]
        .filter(Boolean).join('｜'),
      dateText: p.dateText,
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
