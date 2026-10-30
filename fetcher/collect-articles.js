/**
 * AI 资讯采集：文章流数据（供站点「AI 资讯」标签页）
 * ------------------------------------------------------------
 * 数据源：
 *   1. ClawHunt 官方文章（黑客松主办方的一线动态，静态页可直接解析）
 *   2. RSS 源（InfoQ / 人人都是产品经理 / 少数派 / 机器之心）
 *
 * 输出 data/articles.json：
 *   { updatedAt, articles: [{ id,title,excerpt,url,source,category,date,minutes,image }] }
 *
 * 运行：node fetcher/collect-articles.js（update.js 自动调用，也可单独跑）
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { SOURCES } = require('./sources');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'articles.json');
const CLAWHUNT_URL = 'https://clawhunt.store/zh/articles';
const CLAWHUNT_BASE = 'https://clawhunt.store';

const CLAWHUNT_CATEGORY = {
  Community: '社区', Product: '产品', Research: '研究', Guide: '指南',
  Security: '安全', Safety: '安全', Platform: '平台', Discovery: '发现',
  System: '系统', Incubation: '孵化', Delivery: '交付实证', Evidence: '交付实证',
  'Delivery Evidence': '交付实证',
};

function httpGet(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0', Accept: '*/*' },
      timeout: 15000,
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(httpGet(new URL(res.headers.location, url).href, redirects - 1));
      }
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(d));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function stripTags(html) {
  // RSS 摘要常有多重转义（&amp;lt; 之类），迭代「去标签→解码」直到干净
  let t = String(html || '');
  for (let i = 0; i < 6; i++) {
    t = t
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&hellip;/g, '…');
  }
  return t.replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ---------------- ClawHunt 官方文章 ---------------- */

/** 提取文章详情页正文（article-prose 容器），保留段落换行 */
function extractArticleBody(html) {
  const i = html.indexOf('article-prose');
  if (i < 0) return '';
  let seg = html.slice(i);
  const stop = seg.search(/<(footer|\/main)|class="article-grid"/);
  if (stop > 0) seg = seg.slice(0, stop);
  const inner = seg.match(/>([\s\S]*)/);
  let t = (inner ? inner[1] : seg)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|h4|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#?\w+;/g, ' ')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  const tail = t.search(/(相关文章|相关阅读|上一篇|下一篇|阅读更多|© |Copyright)/);
  if (tail > t.length * 0.4) t = t.slice(0, tail);
  return t.slice(0, 4000).trim();
}

async function fetchClawhuntArticleBody(url, title) {
  try {
    const html = await httpGet(url);
    let t = extractArticleBody(html);
    if (!t) return '';
    // 去掉混进正文开头的英文分类词与重复标题行
    const titleCore = String(title || '').replace(/\s+/g, '').slice(0, 16);
    t = t.split('\n').filter((l) => {
      const line = l.trim();
      if (/^(Community|Product|Research|Guide|Security|Platform|Discovery|System|Incubation|Delivery Evidence)$/i.test(line)) return false;
      if (titleCore && line.replace(/\s+/g, '').startsWith(titleCore)) return false;
      return true;
    }).join('\n');
    return t;
  } catch (e) { return ''; }
}

function parseClawhunt(html) {
  const out = [];
  const blocks = html.split(/<article class="article-card/).slice(1);
  for (const b of blocks) {
    const slug = (b.match(/data-article-slug="([^"]+)"/) || [])[1];
    const link = (b.match(/<h3><a[^>]+href="([^"]+)"/) || [])[1] || (slug ? `/zh/articles/${slug}` : '');
    if (!link) continue;
    const title = stripTags((b.match(/<h3><a[^>]*>([\s\S]*?)<\/a>/) || [])[1]);
    if (!title) continue;
    const img = (b.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '';
    // meta: "Community · 5 min · <time ...>2026-10-25</time>"
    const meta = (b.match(/<p class="article-card__meta">([\s\S]*?)<\/p>/) || [])[1] || '';
    const metaText = stripTags(meta);
    const minutes = (metaText.match(/(\d+)\s*min/i) || [])[1] || '';
    const date = (meta.match(/<time[^>]*datetime="([^"]+)"/) || [])[1] || '';
    const catEn = metaText.split('·')[0].trim();
    const excerpt = stripTags((b.match(/<\/h3><p>([\s\S]*?)<\/p>/) || b.match(/<\/a><\/h3><p>([\s\S]*?)<\/p>/) || [])[1]).slice(0, 160);

    out.push({
      id: `clawhunt-${slug || title.slice(0, 20)}`,
      title,
      excerpt,
      url: CLAWHUNT_BASE + link,
      source: 'ClawHunt',
      category: CLAWHUNT_CATEGORY[catEn] || (catEn || '动态'),
      date: (date || '').slice(0, 10),
      minutes: minutes ? Number(minutes) : null,
      image: img ? (img.startsWith('http') ? img : CLAWHUNT_BASE + img) : '',
    });
  }
  return out;
}

/* ---------------- RSS ---------------- */

function parseRss(xml, sourceName) {
  const out = [];
  const items = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const it of items) {
    const tag = (t) => { const m = it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1] : ''; };
    const title = stripTags(tag('title'));
    const link = (stripTags(tag('link')) || (it.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '').trim();
    if (!title || !link) continue;
    let desc = stripTags(tag('description') || tag('summary') || tag('content')).replace(/[<>]/g, ' ').trim();
    // InfoQ 等源的摘要常只有「点击查看原文」链接壳，视为无摘要
    if (!desc || desc.length < 14 || /^[^一-龥a-zA-Z]*$/.test(desc) || /点击查看原文/.test(desc)) desc = '';
    const pub = stripTags(tag('pubDate') || tag('published') || tag('updated'));
    const d = pub ? new Date(pub) : null;
    const date = d && !isNaN(d) ? d.toISOString().slice(0, 10) : '';
    const img = (it.match(/<enclosure[^>]*url="([^"]+)"/i) || [])[1] ||
                (it.match(/<img[^>]+src="(https?:[^"]+)"/i) || [])[1] || '';

    out.push({
      id: `rss-${sourceName}-${title.slice(0, 24)}`,
      title,
      excerpt: desc,
      url: link,
      source: sourceName,
      category: '资讯',
      date,
      minutes: Math.max(2, Math.round(desc.length / 80)) || null,
      image: img,
    });
  }
  return out;
}

/* ---------------- 公众号文章（复用活动库里的公众号条目） ---------------- */

/**
 * 活动库里已经抓过一批公众号文章（fetch.js 的搜狗微信源），
 * 其中带全文的可以直接作为资讯展示，不必再去搜狗二次请求（搜狗链接易过期）。
 */
function parseWechatEvents() {
  const p = path.join(ROOT, 'data', 'events.json');
  if (!fs.existsSync(p)) return [];
  let db;
  try { db = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
  const out = [];
  for (const e of db.events || []) {
    const isMp = /公众号|mp\.weixin|sogou/.test(`${e.source || ''} ${e.url || ''}`);
    if (!isMp) continue;
    const body = (e.content || e.desc || '').trim();
    if (body.length < 120) continue;               // 太短的不是完整文章
    out.push({
      id: `mp-${(e.id || '').slice(0, 40)}`,
      title: e.title,
      excerpt: (e.summary || body).slice(0, 160),
      content: body.slice(0, 6000),
      url: e.url,
      source: '公众号',
      category: /Agent|智能体/i.test(e.title) ? '智能体' : '资讯',
      date: e.dateStart || '',
      minutes: Math.max(2, Math.round(body.length / 400)),
      image: '',
    });
  }
  return out;
}

/* ---------------- 主流程 ---------------- */

async function main() {
  console.log('▶ 采集 AI 资讯文章…');
  const jobs = [
    { name: 'ClawHunt', run: async () => parseClawhunt(await httpGet(CLAWHUNT_URL)) },
    { name: '公众号(活动库)', run: async () => parseWechatEvents() },
  ]
    .concat(SOURCES.filter((s) => s.type === 'rss').map((s) => ({
      name: s.name,
      run: async () => parseRss(await httpGet(s.url), s.name),
    })));

  const all = [];
  await Promise.all(jobs.map(async (j) => {
    try {
      const items = await j.run();
      console.log(`  ✓ ${j.name.padEnd(14)} ${items.length} 篇`);
      all.push(...items);
    } catch (e) {
      console.log(`  ✗ ${j.name} 失败: ${e.message}`);
    }
  }));

  // 去重 + 排序 + 截断
  const seen = new Set();
  const uniq = all.filter((a) => {
    const raw = String(a.url || '');
    // 公众号文章 ID 常在 query 里（mp.weixin.qq.com/s?__biz=...&mid=...），
    // 无脑去掉 query 会把所有公众号文章压成同一个 URL 而误杀
    const isMp = /mp\.weixin\.qq\.com|weixin\.sogou\.com/.test(raw);
    const k = isMp ? raw : raw.replace(/[?#].*$/, '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  uniq.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  // 截断时优先保留带全文的（公众号 / ClawHunt 可站内阅读），
  // 否则它们会因日期较早被纯链接的 RSS 条目挤出去
  const withBody = uniq.filter((a) => a.content && a.content.length > 200);
  const rest = uniq.filter((a) => !(a.content && a.content.length > 200));
  const articles = withBody.concat(rest).slice(0, 120);

  // ClawHunt 文章静态可解析 → 直接抓全文存 content（站内阅读器用）
  const clawhunt = articles.filter((a) => a.source === 'ClawHunt');
  if (clawhunt.length) {
    console.log(`  … 抓取 ${clawhunt.length} 篇 ClawHunt 文章全文`);
    let done = 0;
    const workers = Array.from({ length: 5 }, async () => {
      while (clawhunt.length) {
        const a = clawhunt.shift();
        a.content = await fetchClawhuntArticleBody(a.url, a.title);
        if (++done % 8 === 0) console.log(`    ${done} 篇完成`);
      }
    });
    await Promise.all(workers);
    const got = articles.filter((a) => a.source === 'ClawHunt' && a.content).length;
    console.log(`  ✓ ClawHunt 全文 ${got}/${articles.filter((a) => a.source === 'ClawHunt').length} 篇`);
  }

  fs.writeFileSync(OUT, JSON.stringify({
    updatedAt: new Date().toISOString(),
    counts: { total: articles.length, sources: [...new Set(articles.map((a) => a.source))] },
    articles,
  }, null, 2), 'utf8');
  console.log(`\n✔ ${articles.length} 篇文章 → ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => { console.error('资讯采集失败:', e); process.exit(1); });
