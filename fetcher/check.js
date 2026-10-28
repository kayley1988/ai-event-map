/**
 * 页面自检：检查各视图渲染、元素位置、控制台报错，并输出截图
 * 用法：node fetcher/check.js [baseUrl]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForTimeout(2200);

  // --- 地图视图 ---
  const map = await page.evaluate(() => {
    const svg = document.getElementById('chinaMap');
    const sr = svg.getBoundingClientRect();
    const markers = [...document.querySelectorAll('.marker')].map((m) => {
      const g = m.getBoundingClientRect();
      const lab = m.querySelector('.marker-label').getBoundingClientRect();
      return {
        city: m.dataset.city,
        transform: m.getAttribute('transform'),
        pinY: Math.round(g.y),
        labelY: Math.round(lab.y),
        labelText: m.querySelector('.marker-label').textContent,
        inViewport: lab.y >= 0 && lab.y < 900,
      };
    });
    return {
      svgRect: { y: Math.round(sr.y), h: Math.round(sr.height) },
      provinces: document.querySelectorAll('.province').length,
      markers: markers.length,
      detail: markers,
    };
  });
  console.log('【地图】', JSON.stringify(map, null, 1));
  await page.screenshot({ path: path.join(OUT, '1-map.png') });

  // --- 城市页 ---
  await page.click('.city-item');
  await page.waitForTimeout(700);
  const city = await page.evaluate(() => ({
    name: document.getElementById('cityName').textContent,
    cards: document.querySelectorAll('#cityEvents .ev-card').length,
    summaryRows: document.querySelectorAll('#citySummary .sum-row').length,
    heroStats: document.getElementById('cityStats').textContent.replace(/\s+/g, ' ').trim(),
  }));
  console.log('【城市页】', JSON.stringify(city));
  await page.screenshot({ path: path.join(OUT, '2-city.png') });

  // --- 详情弹窗 ---
  await page.click('#cityEvents .ev-card');
  await page.waitForTimeout(600);
  const modal = await page.evaluate(() => ({
    open: !document.getElementById('eventModal').hidden,
    title: document.getElementById('modalTitle')?.textContent,
    countdown: document.querySelector('.dt-count b')?.textContent,
  }));
  console.log('【弹窗】', JSON.stringify(modal));
  await page.screenshot({ path: path.join(OUT, '3-modal.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // --- 日历 ---
  await page.click('.tab[data-view="calendar"]');
  await page.waitForTimeout(700);
  const cal = await page.evaluate(() => ({
    groups: document.querySelectorAll('.cal-group').length,
    items: document.querySelectorAll('.cal-item').length,
    firstDn: document.querySelector('.dn')?.textContent.replace(/\s+/g, ' ').trim(),
  }));
  console.log('【日历】', JSON.stringify(cal));
  await page.screenshot({ path: path.join(OUT, '4-calendar.png') });

  // --- 关注 ---
  await page.click('.tab[data-view="watching"]');
  await page.waitForTimeout(500);
  const watch = await page.evaluate(() => ({
    cards: document.querySelectorAll('.watch-card').length,
    empty: !!document.querySelector('.empty'),
  }));
  console.log('【关注】', JSON.stringify(watch));

  // --- 关注一个活动后应出现 ---
  await page.click('.tab[data-view="map"]');
  await page.waitForTimeout(400);
  await page.click('.city-item');
  await page.waitForTimeout(600);
  const wbtn = await page.$('#cityEvents [data-watch]');
  if (wbtn) {
    await wbtn.click();
    await page.waitForTimeout(400);
    await page.click('.tab[data-view="watching"]');
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => document.querySelectorAll('.watch-card').length);
    console.log('【关注后卡片数】', after);
    await page.screenshot({ path: path.join(OUT, '5-watch.png') });
  }

  console.log('\n【报错】', errors.length ? errors.join('\n') : '无');
  await browser.close();
})();
