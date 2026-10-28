/**
 * 探测：活动详情页能提取到什么
 * 用法：node fetcher/probe-detail.js
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // 1. 搜索页
  await page.goto('https://www.huodongxing.com/events', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.waitForTimeout(4500);
  await page.evaluate(() => {
    const box = document.querySelector('input[type=text],input[name=keyword],.search-input,input[placeholder*=搜索]');
    if (box) {
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(box, 'AI黑客松');
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.focus();
    }
  });
  await page.waitForTimeout(800);
  // Enter 可能触发跳转，用 Promise.all 包裹避免执行上下文销毁
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
    page.keyboard.press('Enter'),
  ]);
  await page.waitForTimeout(6000);

  console.log('当前 URL:', page.url());

  // 详情链接是 JS 跳转，直接点击卡片标题进入详情页
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.search-tab-content-item-mesh')];
    for (const it of items) {
      const t = (it.innerText || '');
      if (/AI|黑客松|人工智能|大模型/i.test(t)) {
        const clickable = it.querySelector('.model-user-title, .title, h3') || it;
        clickable.click();
        return;
      }
    }
  });
  await page.waitForTimeout(5000);

  const detail = await page.evaluate(() => {
    const body = document.body.innerText.replace(/\n{2,}/g, '\n');
    return { url: location.href, bodyLen: body.length, body: body.slice(0, 3000) };
  });
  console.log('\n详情页 URL:', detail.url);
  console.log('正文长度:', detail.bodyLen);
  console.log('\n=== 详情正文 ===\n' + detail.body);

  await browser.close();
})();
