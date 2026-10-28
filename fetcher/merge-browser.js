/**
 * 浏览器抓取结果 → 结构化活动
 * ------------------------------------------------------------
 * 读取 data/browser-out/raw.json，用与 fetch.js 相同的识别逻辑
 * （城市 / 日期 / 场地 / 类型 / 标题清洗）转成活动条目，
 * 追加到 data/events.json。
 *
 * 运行：node fetcher/merge-browser.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'browser-out', 'raw.json');
const OUT = path.join(ROOT, 'data', 'events.json');

/* ---- 从 fetch.js 复用识别逻辑（保持一致，避免维护两份） ---- */
const {
  detectCity, parseDate, detectVenue, detectAudience,
  detectType, refineTitle, isPastEvent, slug, isRealVenue,
  extractHighlights, buildSummary,
} = require('./parsers');

/** AI 相关性判定：与 fetch.js 同口径 */
const AI_TERMS = [
  'ai', 'a.i.', '人工智能', '大模型', 'llm', 'agent', '智能体', 'gpt', '机器学习',
  '深度学习', '生成式', 'genai', 'transformer', '多模态', '具身智能',
  'openai', 'claude', 'deepseek', 'kimi', 'qwen', '文心', '豆包', '智谱',
  'chatgpt', 'copilot', 'cursor', 'vibe coding', '提示词', 'prompt', '算法',
];

/** 强 AI 信号：标题里出现才算数（防止 desc 里的泛化词造成误判） */
const AI_TITLE_STRONG = [
  'ai', 'a.i.', '人工智能', '大模型', 'llm', 'agent', '智能体', 'gpt',
  '生成式', 'genai', 'transformer', '多模态', '具身智能', 'aigc', '机器学习',
  '深度学习', 'openai', 'claude', 'deepseek', 'kimi', 'qwen', 'chatgpt',
  '大语言模型', '智能问答', '算法', 'aiq', 'agi',
];

/** 明显与 AI 无关的活动类型（活动行默认列表里大量存在） */
const OFF_TOPIC = [
  '美妆', '首饰', '包装展', '时尚', '情趣', '筋膜', '戏剧季', '歌剧', '话剧',
  '美雕', '艾灸', '养生', '健康产业', '宠物', '.Forms', '演出', '音乐会',
  '书展', '车展', '房展', '家装', '建材', '纺织', '珠宝', '化妆品', '食品展',
  '旅游', '美食', '医疗展', '药房', '母婴', '婚博', '家居', '建材展',
  '校园戏剧', '嘉年华', '庙会', '灯会', '赛事', '球赛', '展会',
];

/** 必须是"技术/AI 性质"的活动形态（排除泛消费品展） */
const AI_EVENT_FORM = [
  '黑客松', 'hackathon', '开发��', '开发者日', '大会', '峰会', '论坛', '沙龙',
  'meetup', '训练营', 'bootcamp', '路演', '黑客马拉松', '挑战赛', '工作坊',
  'workshop', '创投', 'demo', '分享会', '交流会', '大赛', '比赛', '营',
];

/** 明确与 AI 强相关的行业活动（即使含"峰会/大会"也保留） */
const AI_ALLOWED_GENERIC = [
  'aigc', '人工智能', '大模型', '智能体', 'ai',
];

function isAIRelated(title, desc) {
  const t = `${title} ${desc}`.toLowerCase();
  const titleLow = String(title).toLowerCase();

  // 明显不相关的领域直接排除
  if (OFF_TOPIC.some((k) => titleLow.includes(k.toLowerCase()))) {
    // 但如果标题里同时有强 AI 词，仍然保留
    if (!AI_TITLE_STRONG.some((k) => titleLow.includes(k.toLowerCase()))) return false;
  }

  // 必须是技术/AI 性质的活动形态
  const hasForm = AI_EVENT_FORM.some((k) => titleLow.includes(k.toLowerCase()));
  if (!hasForm) return false;

  // 标题含强 AI 信号 → 通过
  if (AI_TITLE_STRONG.some((k) => titleLow.includes(k.toLowerCase()))) return true;

  // 否则要求描述也含 AI 词
  return AI_TERMS.some((k) => t.includes(k.toLowerCase()));
}

function buildEvent(it) {
  const title = refineTitle(it.title, it.desc);
  if (!title || title.replace(/[^\u4e00-\u9fa5a-z0-9]/gi, '').length < 6) return null;
  if (isPastEvent(it.title, it.desc)) return null;
  // 站点名/导航项不是活动
  if (/AI\s*Competition\s*Radar|全球\s*AI\s*活动\s*地图|一站汇总正在报名/i.test(it.title)) return null;
  // 非 AI 相关的活动直接丢弃（活动行默认列表会有大量无关活动）
  if (!isAIRelated(it.title, it.desc)) return null;

  const dateInfo = parseDate(`${it.desc} ${it.title} ${it.dateText || ''}`);
  if (!dateInfo) return null;
  const dateStart = typeof dateInfo === 'string' ? dateInfo : dateInfo.start;
  const dateEnd = typeof dateInfo === 'string' ? '' : (dateInfo.end || '');

  let city = detectCity(`${it.desc} ${it.title} ${it.city || ''}`);
  // 聚合站（AI Competition Radar）是全球赛事，强制标记为线上，不做城市推断
  const isGlobal = it.platform === 'radar';
  if (isGlobal) city = '线上';
  // 活动行的"线上活动"标记
  const isOnline = !isGlobal && /线上活动|线上|online/i.test(`${it.city || ''} ${it.venue || ''} ${it.title}`);
  if (!city && isOnline) city = '线上';
  if (!city && /全球|global|online|worldwide/i.test(`${it.title} ${it.desc}`)) city = '线上';
  if (!city) return null;

  const now = new Date();
  const d = new Date(dateStart + 'T00:00:00+08:00');
  if (d < new Date(now.getTime() - 864e5)) return null;
  if (d > new Date(now.getTime() + 864e5 * 180)) return null;

  const venue = detectVenue(it.desc) || (isGlobal ? '线上' : '待定');
  const audience = detectAudience(it.desc);
  const highlights = extractHighlights(`${it.desc || ''} ${it.detail || ''}`);
  const realVenue = isRealVenue(venue) ? venue : (isGlobal ? '线上' : '待定');

  const ev = {
    id: `${slug(title)}-${dateStart}`,
    city: city || '线上',
    title,
    type: detectType(it.title, it.desc),
    dateStart,
    dateEnd,
    venue: realVenue,
    address: '',
    audience,
    highlight: false,
    url: it.url || '',
    desc: (it.desc || it.detail || '').slice(0, 400),
    source: it.platformName || '浏览器抓取',
    sourceUrl: it.url || '',
    sample: false,
    online: !city,
    host: it.host || it.author || '',
  };
  ev.summary = buildSummary(ev);
  ev.highlights = highlights;
  return ev;
}

function main() {
  const sources = [];
  for (const f of ['raw.json', 'radar.json']) {
    const p = path.join(ROOT, 'data', 'browser-out', f);
    if (!fs.existsSync(p)) continue;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const arr of Object.values(raw.results || {})) sources.push(...arr);
  }
  if (!sources.length) {
    console.log('✗ 未找到浏览器抓取结果，先运行 node fetcher/browser-fetch.js');
    process.exit(1);
  }
  const items = sources;

  const events = [];
  for (const it of items) {
    const ev = buildEvent(it);
    if (ev) events.push(ev);
  }
  console.log(`  浏览器候选 ${items.length} 条 → 结构化 ${events.length} 条`);

  // 合并进 events.json
  let db = { events: [] };
  if (fs.existsSync(OUT)) {
    try { db = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* ignore */ }
  }
  const exist = new Set((db.events || []).map((e) => e.id));
  let added = 0;
  for (const ev of events) {
    if (exist.has(ev.id)) continue;
    db.events.push(ev);
    exist.add(ev.id);
    added++;
  }
  db.events.sort((a, b) => String(a.dateStart).localeCompare(String(b.dateStart)) || a.city.localeCompare(b.city));
  db.updatedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(db, null, 2), 'utf8');
  console.log(`  ✔ 新增 ${added} 条，当前共 ${db.events.length} 条`);
}

main();
