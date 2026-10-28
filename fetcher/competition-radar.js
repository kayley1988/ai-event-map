/**
 * AI Competition Radar 源
 * ------------------------------------------------------------
 * 这是一个高质量的 AI 竞赛/黑客松聚合站，数据以 Next.js flight
 * 格式内嵌在页面中，含精确日期与官方链接。
 *
 * 该站活动多为全球赛事，中国线下活动较少，因此主要用于：
 *   1) 补充全球重要 AI 赛事
 *   2) 作为城市/日期识别器的交叉验证源
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36';
const BASE = 'https://www.aicompetition.dev';

function get(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, timeout: 25000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(''); }
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => resolve(Buffer.concat(c).toString('utf8')));
    }).on('error', () => resolve('')).on('timeout', function () { this.destroy(); resolve(''); });
  });
}

/** 提取 Next.js flight 数据 */
function extractFlight(html) {
  const chunks = [];
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { chunks.push(JSON.parse(m[1])); } catch (e) { /* ignore */ }
  }
  return chunks.join('');
}

/** 从 flight 数据中解析活动条目 */
function parseEvents(flight) {
  const out = [];
  // 结构： "article","<id>" ... "href":"/competitions/<slug>" ... "children":"<title>" ... "label":"...","date":"..."
  const pat = /"article","([a-z0-9\-_]+)"[\s\S]{0,900}?"href":"\/competitions\/([a-z0-9\-_]+)"[\s\S]{0,260}?"children":"([^"]{4,120})"[\s\S]{0,900}?"label":"([^"]+)","date":"([^"]+)"/g;
  let m;
  while ((m = pat.exec(flight)) !== null) {
    out.push({
      id: m[2],
      title: m[3],
      milestone: m[4],
      date: m[5],
      url: `${BASE}/competitions/${m[2]}`,
    });
  }
  return out;
}

async function main() {
  const outDir = path.join(__dirname, '..', 'data', 'browser-out');
  fs.mkdirSync(outDir, { recursive: true });

  const pages = ['/zh', '/zh/competitions'];
  const all = [];
  const seen = new Set();

  for (const p of pages) {
    const html = await get(BASE + p);
    if (!html) { console.log(`  ✗ ${p} 抓取失败`); continue; }
    const flight = extractFlight(html);
    const evs = parseEvents(flight);
    console.log(`  ✓ ${p} → ${evs.length} 条`);
    for (const e of evs) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      all.push({
        title: e.title,
        desc: `${e.title} · ${e.milestone} · ${e.date.slice(0, 10)}`,
        url: e.url,
        platformName: 'AI Competition Radar',
        platform: 'radar',
        query: p,
        dateRaw: e.date,
        milestone: e.milestone,
      });
    }
  }

  const outFile = path.join(outDir, 'radar.json');
  fs.writeFileSync(outFile, JSON.stringify({ updatedAt: new Date().toISOString(), results: { radar: all } }, null, 2), 'utf8');
  console.log(`\n✔ 共 ${all.length} 条 → ${outFile}`);
  for (const e of all.slice(0, 10)) {
    console.log(`   ${String(e.dateRaw).slice(0, 10)}  ${e.title}`);
  }
}

main();
