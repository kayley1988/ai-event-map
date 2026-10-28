/**
 * 浏览器补正文：对缺少完整正文（content < 150 字）的活动，
 * 用 Playwright 真实浏览器回源渲染页面，提取全文。
 *
 * - 微信公众号（含搜狗跳转链）优先取 #js_content 全文
 * - B站/抖音等视频页跳过（正文是推荐流噪音，没有报名信息）
 * - 结果直接写回 data/events.json 的 content 字段
 *
 * 运行：node fetcher/detail-browser.js （由 update.js 自动调用）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'events.json');
const SKIP_DOMAIN = /bilibili\.com|douyin\.com|xiaohongshu\.com/i;

async function main() {
  const db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const targets = (db.events || []).filter(
    (e) => e.url && /^https?:/.test(e.url) && !SKIP_DOMAIN.test(e.url) &&
           (!e.content || e.content.length < 150)
  );
  if (!targets.length) {
    console.log('  所有活动都已有正文，跳过浏览器补全');
    return;
  }
  console.log(`  需补正文 ${targets.length} 条…`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const ctx = await browser.newContext({
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  let ok = 0;
  const done = { n: 0 };
  const flush = () => fs.writeFileSync(DATA, JSON.stringify(db, null, 2), 'utf8');

  /**
   * 微信公众号事件：搜狗的 /link 是一次性链接会过期，
   * 所以像人一样现场搜一遍（标题去噪后作为关键词），
   * 点进标题匹配的结果拿新鲜链接 + 全文
   */
  async function fetchWechatArticle(title) {
    const q = title
      .replace(/[【】\[\]（）()「」]/g, ' ')
      .replace(/\d{1,2}月\d{1,2}日?/g, ' ')
      .replace(/[·・,，。|｜]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 24);
    if (!q) return null;

    await page.goto(`https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(q)}`, {
      waitUntil: 'domcontentloaded', timeout: 25000,
    });
    await page.waitForTimeout(2600);

    const href = await page.evaluate((kw) => {
      const items = [...document.querySelectorAll('li[id^="sogou_vr_"]')];
      const core = kw.replace(/\s+/g, '');
      let fallback = '';
      for (const it of items) {
        const a = it.querySelector('h3 a');
        if (!a) continue;
        const txt = (a.innerText || '').replace(/\s+/g, '');
        if (!fallback) fallback = a.href;
        if (core && (txt.includes(core.slice(0, 8)) || txt.slice(0, 8).includes(core.slice(0, 8)))) return a.href;
      }
      return fallback;
    }, q);
    if (!href) return null;

    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2600);
    if (page.url().includes('antispider') || !/mp\.weixin\.qq\.com/.test(page.url())) return null;

    const text = await page.evaluate(() => {
      const el = document.querySelector('#js_content');
      return el ? el.innerText : '';
    });
    if (!text || text.length < 120) return null;
    return { url: page.url(), text };
  }

  for (const e of targets) {
    try {
      const isWechat = (e.source || '').includes('公众号') || (e.url || '').includes('weixin.sogou.com');
      let text = '';

      if (isWechat) {
        const r = await fetchWechatArticle(e.title).catch(() => null);
        if (!r) {
          console.log(`  ✗ 搜狗反爬/未命中：${e.title.slice(0, 24)}`);
          continue;
        }
        text = r.text;
        e.url = r.url;
        e.sourceUrl = r.url;
      } else {
        let url = e.url;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForTimeout(2200);
        text = await page.evaluate(() => {
          const pick = (sel) => {
            const el = document.querySelector(sel);
            return el ? el.innerText : '';
          };
          return pick('#js_content') ||
                 pick('article') ||
                 pick('.rich_media_content') ||
                 pick('main') ||
                 document.body.innerText || '';
        });
      }

      let t = String(text || '').replace(/\s+/g, ' ').trim();
      const tail = t.search(/(阅读原文|下一篇|相关阅读|上一篇|免责声明|喜欢此内容|人划线|微信扫一扫|扫码关注|Copyright|版权所有|轻点两下取消赞|预览时标签不可点)/);
      if (tail > t.length * 0.5) t = t.slice(0, tail);

      if (t.length >= 120) {
        e.content = t.slice(0, 3000);
        ok++;
        console.log(`  ✓ ${e.content.length} 字｜${e.title.slice(0, 26)}`);
      } else {
        console.log(`  - 正文太短(${t.length}字)｜${e.title.slice(0, 26)}`);
      }
    } catch (err) {
      console.log(`  ✗ ${e.title.slice(0, 26)}：${String(err.message).split('\n')[0]}`);
    }
    if (++done.n % 10 === 0) { flush(); console.log(`    ${done.n}/${targets.length} 已暂存`); }
  }

  flush();
  await browser.close();
  console.log(`  ✔ 浏览器补全正文 ${ok}/${targets.length} 条`);
}

main().catch((e) => { console.error('补正文失败:', e); process.exit(1); });
