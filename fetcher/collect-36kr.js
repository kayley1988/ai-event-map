/**
 * 36氪 资讯采集（36kr.com/information/technology）
 * ------------------------------------------------------------
 * 反爬说明：36氪 对纯 HTTP 请求一律返回 JS 挑战页（/feed 等 RSS 端点已失效），
 * 必须用真实浏览器渲染才能拿到 DOM。因此这里用 Playwright 而不是 httpGet。
 *
 * 卡片结构：a[href*="/p/"] 容器内按行排列
 *   标题 ⏎ 摘要 ⏎ 来源（如「极客邦科技InfoQ」） ⏎ 2小时前
 *
 * 产出：data/browser-out/36kr.json
 * 运行：node fetcher/collect-36kr.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'browser-out');
const OUT = path.join(OUT_DIR, '36kr.json');

const PAGES = [
  'https://36kr.com/information/technology',   // 科技
  'https://36kr.com/information/AI',           // AI
];

/** 相对时间 → YYYY-MM-DD */
function toDate(text, now = new Date()) {
  const t = String(text || '').trim();
  const m = t.match(/^(\d+)\s*(分钟|小时|天)前/);
  if (m) {
    const n = Number(m[1]);
    const ms = m[2] === '分钟' ? n * 6e4 : m[2] === '小时' ? n * 36e5 : n * 864e5;
    return new Date(now.getTime() - ms).toISOString().slice(0, 10);
  }
  if (/昨天/.test(t)) return new Date(now.getTime() - 864e5).toISOString().slice(0, 10);
  const d = t.match(/(\d{4})-(\d{2})-(\d{2})/) || t.match(/(\d{2})-(\d{2})/);
  if (d) {
    if (d[0].length === 10) return d[0];
    return `${now.getFullYear()}-${d[1]}-${d[2]}`;
  }
  return now.toISOString().slice(0, 10);
}

/** 卡片行 → 文章对象；无法识别返回 null */
function parseCard(card, now) {
  const lines = card.text.split('⏎').map((s) => s.trim()).filter(Boolean);
  if (lines.length < 3) return null;
  const timeLine = lines.find((l) => /前$|昨天|\d{2}-\d{2}|\d{4}-\d{2}-\d{2}/.test(l) && l.length < 20);
  if (!timeLine) return null;
  const title = lines[0];
  if (!title || title.length < 8) return null;
  // 摘要是标题之后、来源之前那段
  const srcIdx = lines.indexOf(timeLine) - 1;
  const source = srcIdx >= 2 ? lines[srcIdx] : '36氪';
  const excerpt = lines.slice(1, Math.max(1, srcIdx)).join(' ').slice(0, 200);

  return {
    id: `kr36-${card.href.split('/').pop()}`,
    title,
    excerpt,
    url: card.href,
    // 统一标为「36氪」：子来源（新智元/机器之心等）写进 byline，
    // 否则前端来源筛选会出现十几个「36氪 · xxx」按钮
    source: '36氪',
    byline: /36氪/.test(source) ? '' : source,
    category: /AI|智能|大模型|Agent|GPT/i.test(title) ? 'AI' : '资讯',
    date: toDate(timeLine, now),
    minutes: Math.max(2, Math.round(excerpt.length / 90)),
    image: '',
  };
}

async function main() {
  console.log('════ 36氪 资讯采集 ════');
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 1200 },
    locale: 'zh-CN',
  });
  const now = new Date();
  const all = [];
  const seen = new Set();

  for (const url of PAGES) {
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4500);
      for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 3500); await page.waitForTimeout(1100); }

      const cards = await page.evaluate(() => {
        const out = [];
        const seenHref = new Set();
        document.querySelectorAll('a[href*="/p/"]').forEach((a) => {
          const href = a.href.split('?')[0];
          if (seenHref.has(href)) return;
          let card = a;
          for (let i = 0; i < 4 && card.parentElement; i++) {
            if ((card.innerText || '').length > 80) break;
            card = card.parentElement;
          }
          const text = (card.innerText || '').replace(/\n+/g, ' ⏎ ').trim();
          if (text.length < 40) return;
          seenHref.add(href);
          out.push({ href, text });
        });
        return out;
      });

      let got = 0;
      for (const c of cards) {
        const a = parseCard(c, now);
        if (!a || seen.has(a.id)) continue;
        seen.add(a.id);
        all.push(a);
        got++;
      }
      console.log(`  ${url.split('/').pop().padEnd(12)} ${got} 篇`);
    } catch (e) {
      console.log(`  ✗ ${url} 失败: ${e.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  if (!all.length) {
    console.log('✗ 未采集到文章（可能被反爬拦截）');
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), articles: all }, null, 1), 'utf8');
  console.log(`  ✔ ${all.length} 篇 → ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => { console.error('36氪 采集失败:', e.message); process.exit(1); });
