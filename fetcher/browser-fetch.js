/**
 * 浏览器抓取器（Playwright 直连）
 * ------------------------------------------------------------
 * 小红书 / 抖音 / 微信公众号 / B站 等强 JS 渲染或需登录的平台，
 * 用真实浏览器渲染后提取内容。
 *
 * 登录态：首次运行需 `node browser-fetch.js --login <platform>`，
 * 用户手动扫码登录，脚本保存 storageState 到 auth/<platform>.json，
 * 之后的定时任务自动加载复用。
 *
 * 运行：node browser-fetch.js
 *      node browser-fetch.js --platform xhs
 *      node browser-fetch.js --login xhs
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const AUTH_DIR = path.join(ROOT, 'data', 'auth');
const OUT_DIR = path.join(ROOT, 'data', 'browser-out');

const QUERIES = {
  xhs: ['AI黑客松', 'AI 大赛 报名', 'AI 开发者大会', 'AI 沙龙 活动'],
  douyin: ['AI黑客松', 'AI 大赛 报名', 'AI 开发者大会'],
  bilibili: ['AI 黑客松', 'AI 大会'],
  huodongxing: [
    'AI黑客松', '人工智能 黑客松', '大模型 开发者大会', 'AI 沙龙',
  ],
};

const PLATFORM_CONF = {
  xhs: {
    name: '小红书',
    url: (q) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(q)}`,
    wait: 4500,
    extract: () => {
      const items = [...document.querySelectorAll('section.note-item')];
      return items.map((e) => ({
        title: (e.querySelector('.title, .footer .title')?.innerText || '').trim(),
        author: (e.querySelector('.author .name, .author-wrapper .name')?.innerText || '').trim(),
        url: e.querySelector('a[href*="/explore/"]')?.href || '',
        desc: (e.innerText || '').replace(/\n+/g, ' | ').slice(0, 300),
      })).filter((x) => x.title);
    },
  },
  douyin: {
    name: '抖音',
    url: (q) => `https://www.douyin.com/search/${encodeURIComponent(q)}`,
    wait: 6000,
    extract: () => {
      // 抖音搜索结果在 SSR 数据里
      const out = [];
      const raw = window.__pace_f || window._ROUTER_DATA;
      const scan = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(scan); return; }
        if (obj.aweme_id && obj.desc) {
          out.push({
            title: String(obj.desc).slice(0, 120),
            author: obj.author?.nickname || '',
            url: `https://www.douyin.com/video/${obj.aweme_id}`,
            desc: String(obj.desc).slice(0, 300),
          });
        }
        for (const k of Object.keys(obj)) scan(obj[k]);
      };
      scan(raw);
      if (!out.length) {
        const items = [...document.querySelectorAll('[data-e2e="search-item"], li[data-e2e="scroll-list-item"]')];
        for (const e of items) {
          const t = (e.innerText || '').trim();
          if (!t) continue;
          out.push({ title: t.split('\n')[0].slice(0, 120), author: '', url: '', desc: t.slice(0, 300) });
        }
      }
      return out;
    },
  },
  bilibili: {
    name: '哔哩哔哩',
    url: (q) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(q)}`,
    wait: 4000,
    extract: () => {
      const items = [...document.querySelectorAll('.bili-video-card, .video-list-item')];
      return items.map((e) => ({
        title: (e.querySelector('.bili-video-card__info--tit')?.innerText || e.querySelector('.title')?.innerText || '').trim(),
        author: (e.querySelector('.bili-video-card__info--author')?.innerText || '').trim(),
        url: e.querySelector('a[href*="bilibili.com/video"]')?.href || '',
        desc: (e.innerText || '').replace(/\n+/g, ' | ').slice(0, 300),
      })).filter((x) => x.title);
    },
  },
  huodongxing: {
    name: '活动行',
    // 活动行的 keyword 参数在 /events 页不生效，需先进入搜索页再输入
    url: () => 'https://www.huodongxing.com/events',
    search: true,
    wait: 5500,
    extract: () => {
      const out = [];
      const seen = new Set();
      // 搜索结果页与列表页结构不同，兼容两套选择器
      const items = [...document.querySelectorAll(
        '.search-tab-content-item-mesh, .item-mesh-conter, .browse-div, .model-user-title'
      )];
      for (const e of items) {
        // 活动行的日期行在 innerText 中（textContent 被 CSS 隐藏）
        const full = `${e.innerText || ''}\n${e.textContent || ''}`;
        const lines = full.split(/[\n\r]+/).map((s) => s.trim()).filter(Boolean);
        if (!lines.length) continue;

        // 标题 = 第一个非日期、非地区、非主办方的行
        let title = '';
        let dateLine = '';
        let region = '';
        let host = '';

        for (const l of lines) {
          if (!title) {
            if (/\d{1,2}\s*[月/]\s*\d{1,2}\s*日?/.test(l)) { dateLine = dateLine || l; continue; }
            if (/^(全国|北京|上海|天津|重庆|广东|江苏|浙江|四川|湖北|陕西|山东|福建|湖南|河南|河北|安徽|江西|辽宁|吉林|黑龙江|山西|云南|贵州|广西|内蒙古|新疆|甘肃|青海|宁夏|西藏|海南|深圳|杭州|广州|成都|武汉|西安|南京|苏州|青岛|长沙|郑州|大连|厦门|福州|济南|昆明|沈阳|合肥|无锡|山西|湖南)[一-龥]{0,4}$/.test(l)) { region = region || l; continue; }
            if (/^\d+$/.test(l) || /粉丝/.test(l)) continue;
            // 主办方名称行（"主办方3970"、"VRplay"、"车库咖啡"）不是标题
            if (/^主办方/.test(l)) continue;
            if (l.length <= 12 && !/[一-龥]{4,}|黑客松|大会|沙龙|赛|节|活动|论坛|峰会|训练营|路演|Workshop|Hackathon|Meetup/i.test(l)) continue;
            title = l;
            continue;
          }
          // 标题之后的行：日期 / 地区 / 主办方 / 粉丝数
          if (!dateLine && /\d{1,2}\s*[月/]\s*\d{1,2}\s*日?/.test(l)) { dateLine = l; continue; }
          if (!region && /[一-龥]{2,8}$/.test(l) && !/粉丝/.test(l) && l.length <= 8) { region = l; continue; }
          if (!host && l.length >= 2 && l.length <= 30 && !/粉丝/.test(l) && !/\d{4}/.test(l)) { host = l; continue; }
        }
        if (!title) continue;

        // 排除与 AI 无关的技术方向（区块链 / Web3 / Unity 等）
        if (/区块链|web3|metaverse|元宇宙|unity\s+labs/i.test(title)) continue;

        const key = title.slice(0, 26);
        if (seen.has(key)) continue;
        seen.add(key);

        out.push({
          title,
          author: host,
          // 活动详情页链接（搜索结果卡片内的 a[href*="/event/"]），去掉 utm 跟踪参数
          url: (e.querySelector('a[href*="/event/"]')?.href || '').split('?')[0],
          desc: [dateLine, region, host].filter(Boolean).join(' | '),
          city: region,
          dateText: dateLine,
          host,
        });
      }
      return out;
    },
  },
};

/* ------------------------------------------------------------------ */

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
}
const has = (name) => process.argv.includes(`--${name}`);

async function main() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const only = arg('platform', null);
  const loginMode = has('login');
  // --skip xhs,douyin ：CI 环境跳过需要登录态的平台
  const skip = new Set((arg('skip', '') || '').split(',').map((s) => s.trim()).filter(Boolean));
  const platforms = (only ? [only] : Object.keys(QUERIES)).filter((p) => !skip.has(p));
  if (skip.size) console.log(`  跳过平台：${[...skip].join(', ')}`);

  const browser = await chromium.launch({
    headless: !loginMode,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const results = {};

  for (const p of platforms) {
    const conf = PLATFORM_CONF[p];
    if (!conf) { console.log(`✗ 未知平台 ${p}`); continue; }

    const stateFile = path.join(AUTH_DIR, `${p}.json`);
    const contextOpts = { locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 1440, height: 900 } };
    if (fs.existsSync(stateFile)) contextOpts.storageState = stateFile;

    const context = await browser.newContext(contextOpts);
    const page = await context.newPage();

    // 反自动化检测：抹掉 webdriver 特征
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      window.chrome = { runtime: {} };
    });

    const collected = [];

    for (const q of QUERIES[p]) {
      const url = conf.url(q);
      console.log(`  · ${conf.name} / ${q}`);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(conf.wait);

        // 需要搜索交互的平台：在搜索框输入关键词并回车
        if (conf.search) {
          const ok = await page.evaluate(async (kw) => {
            const box = document.querySelector('input[type="text"], input[name="keyword"], .search-input, input[placeholder*="搜索"], input[placeholder*="活动"]');
            if (!box) return false;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(box, kw);
            box.dispatchEvent(new Event('input', { bubbles: true }));
            box.dispatchEvent(new Event('change', { bubbles: true }));
            box.focus();
            return true;
          }, q);
          if (ok) {
            await page.waitForTimeout(800);
            await page.keyboard.press('Enter').catch(() => {});
            await page.waitForTimeout(conf.wait);
          } else {
            console.log('    · 未找到搜索框，改用默认列表');
          }
        }

        // 滚动加载更多
        await page.evaluate(() => window.scrollBy(0, 1200)).catch(() => {});
        await page.waitForTimeout(1200);
        const items = await page.evaluate(conf.extract);
        if (items.length) {
          console.log(`    → ${items.length} 条`);
          for (const it of items) collected.push({ ...it, query: q, platform: p, platformName: conf.name });
        } else {
          console.log('    → 0 条（可能需要登录）');
        }
      } catch (e) {
        console.log(`    ✗ ${e.message.split('\n')[0]}`);
      }
    }

    if (loginMode) {
      console.log(`\n  浏览器已打开（${conf.name}）。请在窗口中完成登录，完成后回到终端按 Enter 保存登录态…`);
      await new Promise((r) => process.stdin.on('data', r));
      await context.storageState({ path: stateFile });
      console.log(`  ✓ 登录态已保存到 ${stateFile}`);
    } else {
      // 未登录也保存一次状态，便于下次复用部分 cookie
      if (collected.length && !fs.existsSync(stateFile)) {
        try { await context.storageState({ path: stateFile }); } catch (e) { /* ignore */ }
      }
    }

    await context.close();

    // 去重
    const seen = new Set();
    const uniq = collected.filter((x) => {
      const k = (x.title || '').slice(0, 30);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    results[p] = uniq;
    console.log(`  ✓ ${conf.name} 合计 ${uniq.length} 条（去重后）`);
  }

  await browser.close();

  const outFile = path.join(OUT_DIR, 'raw.json');
  fs.writeFileSync(outFile, JSON.stringify({ updatedAt: new Date().toISOString(), results }, null, 2), 'utf8');
  console.log(`\n✔ 原始数据已写入 ${outFile}`);

  if (loginMode) {
    console.log('\n提示：登录态仅保存在本机 data/auth/ 目录，不会上传到任何服务器。');
  }
}

main().catch((e) => { console.error('浏览器抓取失败:', e); process.exit(1); });
