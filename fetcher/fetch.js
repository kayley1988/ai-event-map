/**
 * 活动抓取器
 * ------------------------------------------------------------
 * 抓取多个来源（搜索引擎 / 微信公众号 / RSS），抽取与 AI 相关的
 * 线下活动信息，解析出城市、日期、场地，写入 data/events.json
 *
 * 运行：node fetcher/fetch.js
 * 可选：node fetcher/fetch.js --verbose
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');
const { SOURCES, EVENT_KEYWORDS, NOISE_KEYWORDS } = require('./sources');
const P = require('./parsers');
const { detectCity, parseDate, detectVenue, detectAudience, detectType, refineTitle, isPastEvent, slug, OLD_YEAR_RE, extractHighlights, buildSummary, isRealVenue } = P;

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_FILE = path.join(DATA_DIR, 'events.json');
const SEED_FILE = path.join(DATA_DIR, 'seed-events.json');
const CACHE_DIR = path.join(DATA_DIR, '.cache');

const VERBOSE = process.argv.includes('--verbose');
const log = (...a) => VERBOSE && console.log('[fetch]', ...a);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const TIMEOUT_MS = 25000;
const CONCURRENCY = 4;

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function httpGet(rawUrl, { headers = {}, redirects = 3 } = {}) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(rawUrl); } catch (e) { return resolve(null); }

    const req = https.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        ...headers,
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return resolve(null);
        const next = new URL(res.headers.location, url).toString();
        return resolve(httpGet(next, { headers, redirects: redirects - 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }

      const chunks = [];
      let stream = res;
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());

      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ text: decode(buf), status: res.statusCode, url: rawUrl });
      });
      stream.on('error', () => resolve(null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function decode(buf) {
  // 优先从 Content-Type 推断；否则按 UTF-8，失败再回退 GBK
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    const iconvLite = require('iconv-lite');
    return iconvLite.decode(buf, 'gbk');
  } catch (e) {
    return utf8;
  }
}

/* ------------------------------------------------------------------ */
/* HTML 工具                                                           */
/* ------------------------------------------------------------------ */

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, '…')
    // 搜狗/必应常见的残留序号与分隔符
    .replace(/&ensp;/g, ' ')
    .replace(/&#0*\d+;/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}


/* ------------------------------------------------------------------ */
/* 各类型源解析                                                         */
/* ------------------------------------------------------------------ */

/** 必应结果页：<li class="b_algo"> ... <h2><a href>title</a></h2> ... <p>desc</p> */
function parseBing(html) {
  const out = [];
  const blocks = html.split(/<li class="b_algo"/).slice(1);
  for (const b of blocks) {
    const a = b.match(/<h2>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = decodeEntities(a[1]);
    const title = stripTags(a[2]);
    let desc = '';
    const p = b.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (p) desc = stripTags(p[1]);
    // 必应会把标题截断，尝试补全
    out.push({ url, title, desc, sourceHtml: b.slice(0, 4000) });
  }
  return out;
}

/** 搜狗微信：<li id="sogou_vr_11002601_box_0"> ... <h3><a href>title</a></h3> ... <p class="txt-info"> */
function parseSogouWechat(html) {
  const out = [];
  const items = html.split(/<li[^>]*id="sogou_vr_11002601_box_/i).slice(1);
  for (const it of items) {
    const a = it.match(/<h3>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const title = stripTags(a[2]);
    let desc = '';
    const p = it.match(/<p[^>]*class="txt-info"[^>]*>([\s\S]*?)<\/p>/i);
    if (p) desc = stripTags(p[1]);
    const acct = it.match(/<a[^>]*class="account"[^>]*>([\s\S]*?)<\/a>/i);
    // 搜狗链接为相对路径，补全为绝对地址
    let link = decodeEntities(a[1]);
    if (link.startsWith('/')) link = 'https://weixin.sogou.com' + link;
    out.push({
      url: link,
      title,
      desc,
      account: acct ? stripTags(acct[1]) : '',
      sourceHtml: it.slice(0, 5000),
    });
  }
  return out;
}

/** RSS / Atom */
function parseFeed(xml) {
  const out = [];
  const items = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const it of items) {
    const title = tagText(it, 'title');
    const link = tagText(it, 'link') || (it.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    const desc = stripTags(tagText(it, 'description') || tagText(it, 'summary') || tagText(it, 'content'));
    const pub = tagText(it, 'pubDate') || tagText(it, 'published') || tagText(it, 'updated') || '';
    if (title) out.push({ url: link.trim(), title: stripTags(title), desc, pubDate: pub, sourceHtml: it.slice(0, 5000) });
  }
  return out;
}

function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : '';
}

/* ------------------------------------------------------------------ */
/* URL 解码：搜狗微信链接需跳转还原                                    */
/* ------------------------------------------------------------------ */

async function resolveSogouUrl(u) {
  if (!u || !u.startsWith('http')) return '';
  const r = await httpGet(u);
  if (!r) return u;
  const m = r.text.match(/url\s*\+?=\s*['"]([^'"]+)['"]/i) || r.text.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (m && m[1].startsWith('http')) return m[1];
  return u;
}

/* ------------------------------------------------------------------ */
/* 落地页正文抓取：搜索摘要信息不全，需回源补全日期/城市/场地         */
/* ------------------------------------------------------------------ */

const FETCH_DETAIL_LIMIT = 45;   // 最多回源多少条
const DETAIL_MIN_SCORE = 6;     // 分数够高才值得回源

/**
 * 从落地页 HTML 提取正文主体：
 * 优先微信公众号 js_content / <article>，否则整页剥标签后
 * 砍掉头部导航和尾部噪音，只留活动相关的核心段落
 */
function extractMainText(html) {
  let text = '';
  const jc = html.match(/<div[^>]*id="js_content"[^>]*>([\s\S]*?)<script/i);
  if (jc) text = stripTags(jc[1]);
  if (!text || text.length < 80) {
    const a = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (a) text = stripTags(a[1]);
  }
  if (!text || text.length < 80) {
    text = stripTags(html);
    // 头部：从第一个活动相关关键词开始（跳过站点导航/菜单）
    const kw = text.match(/(?:报名|活动时间|活动介绍|大赛|黑客松|大会|峰会|沙龙|讲座|论坛|议程|嘉宾|日程)/);
    if (kw && kw.index > 0) text = text.slice(kw.index);
    // 尾部：只砍强噪音标记，且仅当出现在全文后 40% 区域（避免误砍正文）
    const tail = text.search(/(阅读原文|下一篇|相关阅读|上一篇|免责声明|喜欢此内容|人划线|微信扫一扫|扫码关注|Copyri?ght|版权所有)/);
    if (tail > text.length * 0.5) text = text.slice(0, tail);
  }
  return text.replace(/\s+/g, ' ').trim();
}

async function fetchDetail(it) {
  if (!it.url || !/^https?:/i.test(it.url)) return it;
  let url = it.url;
  let html = null;
  if (url.includes('weixin.sogou.com')) {
    // 搜狗跳转链接 → 还原真实微信文章地址再抓正文；反爬拦截则保留搜索摘要
    const real = await resolveSogouUrl(url);
    if (!real || real === url) return it;
    url = real;
    const r = await httpGet(url, { headers: { Referer: 'https://weixin.sogou.com/' } });
    if (!r || !r.text) return it;
    html = r.text;
  } else {
    const r = await httpGet(url, { headers: { Referer: 'https://cn.bing.com/' } });
    if (!r || !r.text) return it;
    html = r.text;
  }
  const content = extractMainText(html).slice(0, 3000);
  // 正文太短说明被反爬页/空壳页骗了，退回搜索摘要
  if (content.length < 120) return { ...it, url };
  return { ...it, url, detail: content };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function fetchSource(src) {
  const results = [];
  for (const q of src.queries) {
    const url = src.url.replace('{q}', encodeURIComponent(q));
    // 缓存键用完整哈希，避免同前缀碰撞导致互相覆盖
    const cacheKey = crypto.createHash('md5').update(url).digest('hex').slice(0, 16);
    const cacheFile = path.join(CACHE_DIR, `${src.id}-${cacheKey}.html`);

    let html = null;
    if (fs.existsSync(cacheFile) && !process.argv.includes('--refresh')) {
      html = fs.readFileSync(cacheFile, 'utf8');
      log('cache hit', src.id, q);
    } else {
      const r = await httpGet(url, { headers: src.type === 'wechat' ? { Referer: 'https://weixin.sogou.com/' } : {} });
      if (r) {
        html = r.text;
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(cacheFile, html);
      }
      log('fetched', src.id, q, html ? html.length : 'FAIL');
    }
    if (!html) continue;

    let items = [];
    if (src.type === 'search') items = parseBing(html);
    else if (src.type === 'wechat') items = parseSogouWechat(html);
    else if (src.type === 'rss') items = parseFeed(html);

    for (const it of items) {
      results.push({ ...it, sourceId: src.id, sourceName: src.name, query: q, weight: src.weight });
    }
  }
  return results;
}

function scoreItem(it) {
  let score = it.weight || 1;
  const t = `${it.title} ${it.desc}`;
  if (isAIActivity(it.title, it.desc)) score += 5; else score -= 4;
  if (isEventLike(it.title, it.desc)) score += 4; else score -= 3;
  if (/报名|招募/.test(t)) score += 2;
  if (detectCity(t)) score += 2;
  if (parseDate(t)) score += 3;
  if (it.account) score += 1;
  if (it.sourceId.startsWith('sogou')) score += 1;
  return score;
}

/* ---------------- 相关性判定 ---------------- */

const AI_TERMS = [
  'ai', 'a.i.', '人工智能', '大模型', 'llm', 'agent', '智能体', 'gpt', '机器学习',
  '深度学习', '生成式', 'genai', 'transformer', '多模态', '具身智能',
  'openai', 'claude', 'deepseek', 'kimi', 'qwen', '文心', '豆包', '智谱',
];

function isAIActivity(title, desc) {
  const t = `${title} ${desc}`.toLowerCase();
  return AI_TERMS.some((k) => t.includes(k.toLowerCase()));
}

function isEventLike(title, desc) {
  const t = `${title} ${desc}`;
  if (NOISE_KEYWORDS.some((k) => t.includes(k))) {
    if (!EVENT_KEYWORDS.some((k) => t.toLowerCase().includes(k.toLowerCase()))) return false;
  }
  const hit = EVENT_KEYWORDS.some((k) => t.toLowerCase().includes(k.toLowerCase()));
  if (!hit) return false;
  const strong = /报名|招募|开始|举办|将于|时间[:：]|地点[:：]|倒计时|截止|嘉宾|议程|现场/i.test(t);
  if (strong) return true;
  return EVENT_KEYWORDS.some((k) => /黑客松|hackathon|开发者大会|开发者日|峰会/.test(k)
    && t.toLowerCase().includes(k.toLowerCase()));
}

function buildEvent(it) {
  const title = refineTitle(it.title, it.desc);
  // 已结束/回顾类内容直接排除
  if (isPastEvent(it.title, it.desc)) return null;
  // 标题里带旧年份 + 回顾 → 旧内容
  if (OLD_YEAR_RE.test(it.title)) return null;
  // 标题清洗后无实质信息（如只剩"活动 报名"）→ 放弃
  if (title.replace(/[^\u4e00-\u9fa5a-z0-9]/gi, '').length < 6) return null;
  // 站点名/导航项不是活动
  if (/AI\s*Competition\s*Radar|全球\s*AI\s*活动\s*地图|一站汇总正在报名/i.test(it.title)) return null;

  // 日期优先取自摘要（更精准），正文兜底
  let dateInfo = parseDate(it.desc) || parseDate(it.title);
  if (!dateInfo) dateInfo = parseDate(it.detail || '');
  // 城市同理
  let city = detectCity(`${it.desc} ${it.title}`);
  if (!city) city = detectCity(it.detail || '');

  if (!city) return null;

  let dateStart = '';
  let dateEnd = '';
  if (dateInfo) {
    dateStart = typeof dateInfo === 'string' ? dateInfo : dateInfo.start;
    dateEnd = typeof dateInfo === 'string' ? '' : (dateInfo.end || '');
  }
  if (!dateStart) return null;

  // 只保留未来 180 天内的活动
  const d = new Date(dateStart + 'T00:00:00+08:00');
  const now = new Date();
  if (d < new Date(now.getTime() - 864e5)) return null;
  if (d > new Date(now.getTime() + 864e5 * 180)) return null;

  const venue = detectVenue(it.desc) || detectVenue(it.detail || '') || detectVenue(it.sourceHtml || '');
  const audience = detectAudience(it.desc);
  const highlights = extractHighlights(`${it.desc || ''} ${it.detail || ''}`);

  const ev = {
    id: `${slug(title)}-${dateStart}`,
    city,
    title,
    type: detectType(it.title, it.desc),
    dateStart,
    dateEnd,
    venue: isRealVenue(venue) ? venue : '待定',
    address: '',
    audience: audience || '',
    highlight: false,
    url: it.url || '',
    // desc = 搜索摘要（短，卡片用）；content = 回源正文（长，详情弹窗用）
    desc: (it.desc || '').slice(0, 400),
    content: (it.detail || '').slice(0, 3000),
    source: it.sourceName || '',
    sourceUrl: it.url || '',
    sample: false,
    host: it.account || '',
  };
  // 摘要尽量从完整正文生成，质量更高
  ev.summary = buildSummary({ ...ev, desc: ev.content || ev.desc });
  ev.highlights = highlights;
  return ev;
}

async function main() {
  console.log('▶ 开始抓取 AI 活动…\n');

  // 1. 并发抓取
  const all = [];
  const queue = [...SOURCES];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const src = queue.shift();
      try {
        const rs = await fetchSource(src);
        console.log(`  ✓ ${src.name.padEnd(28)} ${String(rs.length).padStart(3)} 条候选`);
        all.push(...rs);
      } catch (e) {
        console.log(`  ✗ ${src.name} 失败: ${e.message}`);
      }
    }
  });
  await Promise.all(workers);

  console.log(`\n  候选总计 ${all.length} 条，开始筛选…`);

  // 2. 过滤 + 打分 + 构建
  const scored = all.map((it) => ({ it, score: scoreItem(it) }));
  const kept = scored.filter((s) => s.score > 0);
  console.log(`  通过初筛 ${kept.length} 条`);

  // 2.5 回源抓正文，补全日期/城市/场地
  const needDetail = kept
    .filter((s) => s.score >= DETAIL_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, FETCH_DETAIL_LIMIT);
  console.log(`  回源抓取正文 ${needDetail.length} 条…`);
  let done = 0;
  const enriched = [];
  for (const s of kept) {
    if (needDetail.includes(s)) {
      try {
        enriched.push({ it: await fetchDetail(s.it), score: s.score });
      } catch (e) {
        enriched.push(s);
      }
      if (++done % 10 === 0) process.stdout.write(`    ${done}/${needDetail.length}\n`);
    } else {
      enriched.push(s);
    }
  }

  const events = [];
  for (const { it } of enriched) {
    const ev = buildEvent(it);
    if (ev) events.push(ev);
  }
  console.log(`  解析出结构化活动 ${events.length} 条`);

  // 3. 去重（同名 + 同城市 + 同日）
  const seen = new Map();
  for (const ev of events) {
    const key = `${ev.city}|${ev.title.replace(/[·・\s]/g, '').slice(0, 16)}|${ev.dateStart}`;
    if (!seen.has(key)) seen.set(key, ev);
  }
  const fresh = [...seen.values()];
  console.log(`  去重后 ${fresh.length} 条`);

  // 4. 与种子数据合并（种子优先保留，避免抓取覆盖高质量人工数据）
  let seed = { events: [] };
  if (fs.existsSync(SEED_FILE)) {
    try { seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')); } catch (e) { /* ignore */ }
  }
  const seedIds = new Set((seed.events || []).map((e) => e.id));
  const seedKeys = new Set((seed.events || []).map((e) => `${e.city}|${e.title.replace(/[·・\s]/g, '').slice(0, 16)}|${e.dateStart}`));
  const merged = [...(seed.events || [])];
  for (const ev of fresh) {
    const key = `${ev.city}|${ev.title.replace(/[·・\s]/g, '').slice(0, 16)}|${ev.dateStart}`;
    if (!seedIds.has(ev.id) && !seedKeys.has(key)) merged.push(ev);
  }

  // 5. 排序
  merged.sort((a, b) => String(a.dateStart).localeCompare(String(b.dateStart)) || a.city.localeCompare(b.city));

  const out = {
    updatedAt: new Date().toISOString(),
    source: 'auto-fetch',
    counts: { total: merged.length, fetched: fresh.length, seed: (seed.events || []).length },
    events: merged,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n✔ 已写入 ${OUT_FILE}`);
  console.log(`  总活动 ${merged.length} 条（自动抓取 ${fresh.length} + 种子 ${(seed.events || []).length}）`);

  const byCity = {};
  for (const e of merged) byCity[e.city] = (byCity[e.city] || 0) + 1;
  console.log('  城市分布:', Object.entries(byCity).map(([c, n]) => `${c}(${n})`).join(' '));
}

main().catch((e) => { console.error('抓取失败:', e); process.exit(1); });
