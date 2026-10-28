/**
 * 探查工具：打开页面并 dump 关键 DOM 结构
 * 用法：node fetcher/probe.js <url> [outFile]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2];
  const outFile = process.argv[3] || path.join(__dirname, '..', 'data', 'browser-out', 'probe.html');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.waitForTimeout(6000);

  const info = await page.evaluate(() => {
    // 找出包含"活动"或日期文本最多的容器类
    const counts = {};
    document.querySelectorAll('div,li,section,article').forEach((el) => {
      const cls = (el.className || '').toString().split(/\s+/).filter(Boolean)[0];
      if (!cls) return;
      counts[cls] = (counts[cls] || 0) + 1;
    });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25);

    // 采样若干含日期的元素
    const dateRe = /\d{1,2}月\d{1,2}日|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}/;
    const samples = [];
    document.querySelectorAll('a,div,li,span,h3,h4').forEach((el) => {
      const t = (el.innerText || '').trim();
      if (!t || t.length > 120) return;
      if (dateRe.test(t)) {
        samples.push({
          tag: el.tagName,
          cls: (el.className || '').toString().slice(0, 60),
          text: t.slice(0, 80),
          parentCls: (el.parentElement?.className || '').toString().slice(0, 60),
        });
      }
    });
    return {
      title: document.title,
      url: location.href,
      bodyLen: document.body.innerText.length,
      topClasses: top,
      dateSamples: samples.slice(0, 25),
      bodyHead: document.body.innerText.slice(0, 2500),
    };
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(info, null, 2), 'utf8');
  const htmlOut = outFile.replace(/\.json$/, '.html');
  fs.writeFileSync(htmlOut, await page.content(), 'utf8');

  console.log('title:', info.title);
  console.log('bodyLen:', info.bodyLen);
  console.log('\ntop classes:', info.topClasses.slice(0, 15).map((c) => `${c[0]}(${c[1]})`).join(' '));
  console.log('\ndate samples:');
  for (const s of info.dateSamples.slice(0, 12)) console.log(`  [${s.tag}.${s.cls.slice(0, 30)}] ${s.text.slice(0, 60)}`);
  console.log('\nbody head:\n', info.bodyHead.slice(0, 800));

  await browser.close();
})();
