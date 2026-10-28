/* =========================================================
 * AI 活动地图 · 应用逻辑
 * ======================================================= */

(function () {
  'use strict';

  /* ---------------- 数据 ---------------- */

  const DATA_URL = 'data/events.json';
  const SEED_URL = 'data/seed-events.json';

  const TYPE_NAME = {
    hackathon: '黑客松',
    conference: '大会 / 峰会',
    salon: '沙龙 / 工作坊',
    meetup: '社区聚会',
  };
  const TYPE_COLOR = {
    hackathon: '#ff5a3c',
    conference: '#2563eb',
    salon: '#7c3aed',
    meetup: '#0891b2',
  };
  const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

  /** 城市坐标（经度, 纬度） */
  const CITY_COORD = {
    北京: [116.41, 39.90], 上海: [121.47, 31.23], 广州: [113.26, 23.13],
    深圳: [114.06, 22.55], 杭州: [120.16, 30.27], 成都: [104.07, 30.67],
    武汉: [114.31, 30.59], 西安: [108.94, 34.34], 南京: [118.78, 32.06],
    合肥: [117.23, 31.82], 重庆: [106.55, 29.56], 天津: [117.20, 39.08],
    苏州: [120.58, 31.30], 青岛: [120.38, 36.07], 长沙: [112.94, 28.23],
    郑州: [113.63, 34.75], 大连: [121.62, 38.92], 宁波: [121.55, 29.87],
    厦门: [118.09, 24.48], 福州: [119.30, 26.08], 济南: [117.00, 36.65],
    无锡: [120.30, 31.57], 昆明: [102.83, 24.88], 沈阳: [123.43, 41.80],
    哈尔滨: [126.53, 45.80], 长春: [125.32, 43.90], 石家庄: [114.51, 38.04],
    太原: [112.55, 37.87], 南宁: [108.37, 22.82], 贵阳: [106.63, 26.65],
    兰州: [103.82, 36.06], 南昌: [115.86, 28.68], 珠海: [113.55, 22.27],
    中山: [113.39, 22.52], 佛山: [113.12, 23.02], 东莞: [113.75, 23.05],
    惠州: [114.41, 23.11], 常州: [119.95, 31.79], 温州: [120.70, 28.00],
    嘉兴: [120.76, 30.75], 绍兴: [120.58, 30.00], 台州: [121.43, 28.66],
    烟台: [121.39, 37.52], 潍坊: [119.10, 36.62], 洛阳: [112.45, 34.62],
    襄阳: [112.14, 32.04], 芜湖: [118.38, 31.33], 保定: [115.48, 38.87],
    廊坊: [116.68, 39.54], 秦皇岛: [119.60, 39.94], 唐山: [118.18, 39.63],
    徐州: [117.28, 34.20], 南通: [120.86, 32.01], 扬州: [119.42, 32.39],
    盐城: [120.16, 33.35], 淮安: [119.02, 33.61], 连云港: [119.22, 34.60],
    金华: [119.65, 29.08], 衢州: [118.87, 28.94], 舟山: [122.11, 30.02],
    赣州: [114.94, 25.85], 九江: [115.99, 29.71], 株洲: [113.13, 27.83],
    湘潭: [112.94, 27.83], 衡阳: [112.57, 26.89], 岳阳: [113.13, 29.37],
    包头: [109.84, 40.66], 赤峰: [118.89, 42.26], 呼和浩特: [111.75, 40.84],
    银川: [106.27, 38.47], 西宁: [101.78, 36.62], 拉萨: [91.11, 29.65],
    乌鲁木齐: [87.62, 43.79], 线上: [116.41, 39.90],
  };

  const state = {
    events: [],
    updatedAt: null,
    view: 'map',
    city: null,
    calFilter: 'all',
    onlyUpcoming: true,
    watched: loadLocal('watched', []),
    customs: loadLocal('customs', []),
    filterText: '',
    articles: [],
    artFilter: '',
    artCat: '',
  };

  /* ---------------- 本地存储 ---------------- */

  function loadLocal(key, dflt) {
    try {
      const raw = localStorage.getItem('aimap_' + key);
      return raw ? JSON.parse(raw) : dflt;
    } catch (e) { return dflt; }
  }
  function saveLocal(key, val) {
    try { localStorage.setItem('aimap_' + key, JSON.stringify(val)); } catch (e) { /* ignore */ }
  }

  /* ---------------- 工具 ---------------- */

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function parseDate(str) {
    if (!str) return null;
    const m = String(str).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], 9, 0, 0);
  }

  function fmtDate(d) {
    if (!d) return '';
    return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
  }

  function fmtFull(d) {
    if (!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 周${WEEKDAY[d.getDay()]}`;
  }

  function fmtRange(ev) {
    const s = parseDate(ev.dateStart);
    if (!s) return '日期待定';
    const e = parseDate(ev.dateEnd);
    if (e && e.getTime() !== s.getTime()) {
      const sameMonth = s.getMonth() === e.getMonth();
      return sameMonth
        ? `${fmtDate(s)} ~ ${e.getDate()}`
        : `${fmtDate(s)} ~ ${fmtDate(e)}`;
    }
    return fmtDate(s);
  }

  function daysBetween(target) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const t = new Date(target); t.setHours(0, 0, 0, 0);
    return Math.round((t - now) / 86400000);
  }

  /** 距离开始还有几天（负数表示已开始/已过） */
  function daysUntil(ev) {
    const s = parseDate(ev.dateStart);
    if (!s) return null;
    return daysBetween(s);
  }

  function countdownText(ev) {
    const d = daysUntil(ev);
    if (d === null) return '';
    if (d < 0) return '已开始';
    if (d === 0) return '今天开始';
    if (d === 1) return '明天开始';
    return `${d} 天后`;
  }

  function isWatched(id) { return state.watched.includes(id); }

  function toggleWatch(id) {
    const i = state.watched.indexOf(id);
    if (i > -1) state.watched.splice(i, 1);
    else state.watched.push(id);
    saveLocal('watched', state.watched);
    updateBadge();
  }

  function updateBadge() {
    const n = state.watched.length + state.customs.length;
    const b = $('#watchBadge');
    b.textContent = n;
    b.hidden = n === 0;
  }

  /* ---------------- 加载数据 ---------------- */

  async function loadData() {
    let db = null;
    try {
      const r = await fetch(DATA_URL + '?t=' + Date.now());
      if (r.ok) db = await r.json();
    } catch (e) { /* file:// 场景会失败，走种子 */ }

    if (!db || !db.events || !db.events.length) {
      try {
        const r = await fetch(SEED_URL);
        if (r.ok) db = await r.json();
      } catch (e) { /* ignore */ }
    }

    state.events = (db && db.events) || [];
    state.updatedAt = db && db.updatedAt;

    // 排序：按开始时间
    state.events.sort((a, b) => String(a.dateStart).localeCompare(String(b.dateStart)));

    renderSyncStatus();
    renderCityList();
    renderMap();
    renderCalendar();
    renderWatch();
    renderArticles();
    renderSiteStats();
    updateBadge();
    loadArticles();
  }

  /** 站点统计横幅（借鉴 ClawHunt 的数据展示区） */
  function renderSiteStats() {
    const el = $('#siteStats');
    if (!el) return;
    const evs = state.events || [];
    const cities = new Set(evs.map((e) => e.city).filter(Boolean)).size;
    const sources = new Set(evs.map((e) => e.source).filter(Boolean)).size;
    const hacks = evs.filter((e) => e.type === 'hackathon').length;
    el.innerHTML = `
      <span class="ss-item"><b>${cities}</b> 座城市</span>
      <span class="ss-item"><b>${evs.length}</b> 场活动</span>
      <span class="ss-item"><b>${hacks}</b> 场黑客松</span>
      <span class="ss-item"><b>${sources}</b> 个数据源</span>
      <span class="ss-item ss-muted">每天 09:01 自动抓取更新</span>`;
  }

  /* ---------------- AI 资讯 ---------------- */

  async function loadArticles() {
    try {
      const r = await fetch('data/articles.json?t=' + Date.now());
      if (r.ok) {
        const db = await r.json();
        state.articles = db.articles || [];
        renderArticles();
      }
    } catch (e) { /* 静默失败，资讯页显示空态 */ }
  }

  function renderArticles() {
    const listEl = $('#articlesList');
    if (!listEl) return;
    const articles = state.articles || [];
    const filtersEl = $('#artFilters');
    const catsEl = $('#artCats');

    // 来源 chips（来源集合变化时重建）
    const sources = ['全部', ...new Set(articles.map((a) => a.source))];
    const sig = sources.join('|');
    if (filtersEl && filtersEl.dataset.sig !== sig) {
      filtersEl.innerHTML = sources.map((s) =>
        `<button class="chip${s === (state.artFilter || '全部') ? ' is-active' : ''}" data-asrc="${esc(s)}">${esc(s)}</button>`).join('');
      filtersEl.dataset.sig = sig;
      $$('#artFilters .chip').forEach((c) => {
        c.addEventListener('click', () => {
          $$('#artFilters .chip').forEach((x) => x.classList.remove('is-active'));
          c.classList.add('is-active');
          state.artFilter = c.dataset.asrc;
          renderArticles();
        });
      });
    }

    // 分类 chips（借鉴 ClawHunt 的主题标签体系）
    const cats = ['全部', ...new Set(articles.map((a) => a.category).filter(Boolean))];
    const catSig = cats.join('|');
    if (catsEl && catsEl.dataset.sig !== catSig) {
      catsEl.innerHTML = cats.map((c2) =>
        `<button class="chip${c2 === (state.artCat || '全部') ? ' is-active' : ''}" data-acat="${esc(c2)}">${esc(c2)}</button>`).join('');
      catsEl.dataset.sig = catSig;
      $$('#artCats .chip').forEach((c2) => {
        c2.addEventListener('click', () => {
          $$('#artCats .chip').forEach((x) => x.classList.remove('is-active'));
          c2.classList.add('is-active');
          state.artCat = c2.dataset.acat;
          renderArticles();
        });
      });
    }

    const shown = articles.filter((a) =>
      (!state.artFilter || state.artFilter === '全部' || a.source === state.artFilter) &&
      (!state.artCat || state.artCat === '全部' || a.category === state.artCat));

    if (!shown.length) {
      listEl.innerHTML = `<div class="empty">
        <div class="empty-emoji">📰</div>
        <p>资讯加载中或暂无文章</p>
        <small>数据每日自动更新</small>
      </div>`;
      return;
    }

    listEl.innerHTML = shown.map((a, i) => `
      <article class="art-row${a.image ? ' has-img' : ''}${a.content ? ' is-readable' : ''}" data-id="${esc(a.id)}">
        <span class="art-num">${String(i + 1).padStart(2, '0')}</span>
        ${a.image ? `<img class="art-thumb" src="${esc(a.image)}" alt="" loading="lazy">` : ''}
        <div class="art-main">
          <div class="art-meta">
            <span class="badge badge-art">${esc(a.category)}</span>
            <span class="art-src">${esc(a.source)}</span>
            ${a.minutes ? `<span>约 ${a.minutes} 分钟</span>` : ''}
            ${a.date ? `<span>${esc(a.date)}</span>` : ''}
            ${a.content ? '<span class="art-readable">📖 站内可读</span>' : ''}
          </div>
          <h3 class="art-title">${highlightTitle(a.title)}</h3>
          ${a.excerpt ? `<p class="art-excerpt">${esc(a.excerpt)}</p>` : ''}
        </div>
        <span class="art-go">${a.content ? '读' : '↗'}</span>
      </article>`).join('');

    $$('#articlesList .art-row').forEach((row) => {
      row.addEventListener('click', () => {
        const a = shown.find((x) => x.id === row.dataset.id);
        if (!a) return;
        // 有全文 → 站内阅读器；没有 → 跳原文
        if (a.content) openArticleReader(a);
        else window.open(a.url, '_blank', 'noopener');
      });
    });
  }

  /** 站内文章阅读器（借鉴 ClawHunt 文章页） */
  function openArticleReader(a) {
    const body = $('#articleBody');
    const paras = String(a.content).split('\n').filter(Boolean)
      .map((p) => `<p>${esc(p)}</p>`).join('');
    body.innerHTML = `
      <div class="rd-meta">
        <span class="badge badge-art">${esc(a.category)}</span>
        <span>${esc(a.source)}</span>
        ${a.minutes ? `<span>约 ${a.minutes} 分钟</span>` : ''}
        ${a.date ? `<span>${esc(a.date)}</span>` : ''}
      </div>
      <h2 class="rd-title">${esc(a.title)}</h2>
      <div class="rd-content">${paras}</div>
      <div class="dt-actions">
        <a class="btn btn-primary" href="${esc(a.url)}" target="_blank" rel="noopener">查看原文 ↗</a>
        <button class="btn" data-close>关闭</button>
      </div>`;
    $('#articleModal').hidden = false;
    body.querySelector('[data-close]').addEventListener('click', closeModal);
    body.scrollTop = 0;
  }

  function renderSyncStatus() {
    const el = $('#syncStatus');
    const txt = $('#syncText');
    if (!state.updatedAt) {
      txt.textContent = '本地数据';
      el.classList.remove('is-stale');
      return;
    }
    const d = new Date(state.updatedAt);
    const diffH = (Date.now() - d.getTime()) / 3600000;
    if (diffH < 1) txt.textContent = '刚刚更新';
    else if (diffH < 24) txt.textContent = `${Math.floor(diffH)} 小时前更新`;
    else txt.textContent = `${Math.floor(diffH / 24)} 天前更新`;
    el.classList.toggle('is-stale', diffH > 48);
    el.title = `最后更新：${d.toLocaleString('zh-CN')}`;
  }

  /* ---------------- 城市列表 ---------------- */

  function cityStats() {
    const map = {};
    for (const ev of state.events) {
      if (!map[ev.city]) map[ev.city] = { total: 0, upcoming: 0, hack: 0 };
      map[ev.city].total++;
      const d = daysUntil(ev);
      if (d !== null && d >= 0) map[ev.city].upcoming++;
      if (ev.type === 'hackathon') map[ev.city].hack++;
    }
    return map;
  }

  function renderCityList() {
    const stats = cityStats();
    const q = state.filterText.trim();
    const cities = Object.keys(stats)
      .filter((c) => !q || c.includes(q))
      .sort((a, b) => stats[b].upcoming - stats[a].upcoming || stats[b].total - stats[a].total);

    $('#cityList').innerHTML = cities.map((c) => `
      <button class="city-item ${state.city === c ? 'is-active' : ''}" data-city="${esc(c)}">
        <span class="city-name">${esc(c)}</span>
        <span class="city-count">${stats[c].upcoming || stats[c].total}</span>
      </button>
    `).join('');

    $('#cityTotal').innerHTML = `<span>${cities.length} 城市 · ${state.events.length} 场</span><span>${sourceCount()} 个来源</span>`;

    $$('#cityList .city-item').forEach((b) => {
      b.addEventListener('click', () => openCity(b.dataset.city));
    });
  }

  /* ---------------- 地图渲染 ---------------- */

  const mapState = { svg: null, gProv: null, gSea: null, gMark: null, wrap: null, tooltip: null };

  function projectToMap(lon, lat) {
    const P = window.MAP_PATHS;
    if (!P) return [0, 0];
    const pr = P.proj;
    const merc = (lo, la) => {
      const y = Math.log(Math.tan(Math.PI / 4 + (la * Math.PI / 180) / 2)) / Math.PI;
      return [lo, y];
    };
    const [x0, y0] = merc(pr.LON_MIN, pr.LAT_MAX);
    const [x1, y1] = merc(pr.LON_MAX, pr.LAT_MIN);
    const [x, y] = merc(lon, lat);
    return [
      ((x - x0) / (x1 - x0)) * pr.w,
      ((y - y0) / (y1 - y0)) * pr.h,
    ];
  }

  function renderMap() {
    const P = window.MAP_PATHS;
    if (!P) { $('#mapLoading').textContent = '地图数据加载失败'; return; }

    mapState.svg = $('#chinaMap');
    mapState.gProv = $('#mapProvinces');
    mapState.gSea = $('#mapSouthSea');
    mapState.gMark = $('#mapMarkers');
    mapState.wrap = $('#mapWrap');
    mapState.tooltip = $('#mapTooltip');

    const stats = cityStats();
    const eventCities = new Set(Object.keys(stats));

    // 省份
    mapState.gProv.innerHTML = P.provinces.map((p) => {
      const cname = normalizeProvince(p.name);
      const st = stats[cname];
      const has = !!st && (st.upcoming > 0 || st.total > 0);
      return `<path class="province ${has ? 'has-events' : ''}" d="${p.d}" data-name="${esc(p.name)}"></path>`;
    }).join('');

    // 南海诸岛插图（右下角）
    if (P.inset) {
      const ins = P.inset;
      const insPaths = (ins.provinces || []).map((p) =>
        `<path class="province" d="${p.d}"></path>`).join('');
      mapState.gSea.innerHTML = `
        <g class="inset-group">
          <rect x="${ins.x - 6}" y="${ins.y - 6}" width="${ins.w + 12}" height="${ins.h + 12}"
                fill="#0b1322" stroke="#2c3a63" stroke-width="0.8" rx="4"></rect>
          ${insPaths}
          ${ins.southSea ? `<path class="south-sea" d="${ins.southSea}"></path>` : ''}
          <text x="${ins.x + ins.w / 2}" y="${ins.y + ins.h + 2}" class="inset-label"
                text-anchor="middle">${esc(ins.label)}</text>
        </g>`;
    }

    renderMarkers();
    $('#mapLoading').classList.add('is-hidden');

    // 省份悬浮提示（显示所属活动数）
    mapState.gProv.querySelectorAll('.province').forEach((path) => {
      path.addEventListener('mouseenter', (e) => {
        const name = path.dataset.name;
        const cname = normalizeProvince(name);
        const st = stats[cname];
        if (!st) return;
        showTip(e, `<strong>${esc(cname)}</strong>
          <div class="tt-line">${st.total} 场活动 · ${st.upcoming} 场未开始</div>
          ${st.hack ? `<div class="tt-line">含 ${st.hack} 场黑客松</div>` : ''}`);
      });
      path.addEventListener('mousemove', moveTip);
      path.addEventListener('mouseleave', hideTip);
      path.addEventListener('click', () => {
        const cname = normalizeProvince(path.dataset.name);
        if (stats[cname]) openCity(cname);
      });
    });
  }

  /** 省级行政区名 → 城市名（用于统计映射） */
  function normalizeProvince(name) {
    const map = {
      北京市: '北京', 上海市: '上海', 天津市: '天津', 重庆市: '重庆',
      广东省: '广州', 江苏省: '南京', 浙江省: '杭州', 四川省: '成都',
      湖北省: '武汉', 陕西省: '西安', 山东省: '济南', 福建省: '福州',
      湖南省: '长沙', 河南省: '郑州', 河北省: '石家庄', 安徽省: '合肥',
      江西省: '南昌', 辽宁省: '沈阳', 吉林省: '长春', 黑龙江省: '哈尔滨',
      山西省: '太原', 云南省: '昆明', 贵州省: '贵阳', 广西壮族自治区: '南宁',
      内蒙古自治区: '呼和浩特', 新疆维吾尔自治区: '乌鲁木齐', 甘肃省: '兰州',
      青海省: '西宁', 宁夏回族自治区: '银川', 西藏自治区: '拉萨', 海南省: '海口',
      台湾省: '台北', 香港特别行政区: '香港', 澳门特别行政区: '澳门',
    };
    return map[name] || name;
  }

  function renderMarkers() {
    const stats = cityStats();
    const cities = Object.keys(stats);
    if (!cities.length) { mapState.gMark.innerHTML = ''; return; }

    mapState.gMark.innerHTML = cities.map((c) => {
      if (c === '线上') return '';   // 线上赛事不落地图
      const coord = CITY_COORD[c];
      if (!coord) return '';
      const [x, y] = projectToMap(coord[0], coord[1]);
      const st = stats[c];
      const n = st.upcoming || st.total;

      // 半径按活动数缩放（上限避免遮挡）
      const r = Math.min(7 + Math.min(n, 12) * 0.42, 12);
      // 颜色：该城市是否有黑客松（红）→ 有大会（蓝）→ 灰
      const color = st.hack > 0 ? TYPE_COLOR.hackathon
        : st.upcoming > 0 ? TYPE_COLOR.conference : '#9ca3af';
      const isHot = st.upcoming > 0;
      // group 已做 translate，标签用相对偏移量
      const labelY = r + 13;

      return `
        <g class="marker" data-city="${esc(c)}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          ${isHot ? `<circle class="halo" r="${r}" fill="url(#markerGlow)"></circle>` : ''}
          <circle class="pin" r="${r}" fill="${color}" stroke="#070b14" stroke-width="2"></circle>
          ${n > 1 ? `<text class="marker-count" x="0" y="3.6" text-anchor="middle">${n}</text>` : ''}
          <text class="marker-label" x="0" y="${labelY.toFixed(1)}" text-anchor="middle">${esc(c)}</text>
        </g>`;
    }).join('');

    mapState.gMark.querySelectorAll('.marker').forEach((g) => {
      const c = g.dataset.city;
      g.addEventListener('mouseenter', (e) => {
        const st = stats[c];
        const list = state.events
          .filter((e2) => e2.city === c)
          .slice(0, 3)
          .map((e2) => `<div class="tt-ev"><i class="tt-dot" style="background:${TYPE_COLOR[e2.type]}"></i><span>${esc(e2.title.slice(0, 22))}</span></div>`)
          .join('');
        showTip(e, `<strong>${esc(c)} · ${st.total} 场</strong>${list}${st.total > 3 ? `<div class="tt-line">还有 ${st.total - 3} 场…</div>` : ''}`);
      });
      g.addEventListener('mousemove', moveTip);
      g.addEventListener('mouseleave', hideTip);
      g.addEventListener('click', () => openCity(c));
    });
  }

  function showTip(e, html) {
    const t = mapState.tooltip;
    t.innerHTML = html;
    t.hidden = false;
    moveTip(e);
  }
  function moveTip(e) {
    const t = mapState.tooltip;
    const wrap = mapState.wrap.getBoundingClientRect();
    const x = e.clientX - wrap.left + 14;
    const y = e.clientY - wrap.top + 14;
    const maxX = wrap.width - t.offsetWidth - 10;
    const maxY = wrap.height - t.offsetHeight - 10;
    t.style.left = Math.min(x, Math.max(0, maxX)) + 'px';
    t.style.top = Math.min(y, Math.max(0, maxY)) + 'px';
  }
  function hideTip() { mapState.tooltip.hidden = true; }

  /* ---------------- 城市页 ---------------- */

  function cityEvents(city) {
    return state.events
      .filter((e) => e.city === city)
      .filter((e) => !state.onlyUpcoming || (daysUntil(e) !== null && daysUntil(e) >= 0));
  }

  function openCity(city) {
    state.city = city;
    renderCityList();
    renderCityPage();
    switchView('city');
  }

  function renderCityPage() {
    const city = state.city;
    const all = state.events.filter((e) => e.city === city);
    const list = cityEvents(city);
    const upcoming = all.filter((e) => { const d = daysUntil(e); return d !== null && d >= 0; });
    const hacks = all.filter((e) => e.type === 'hackathon').length;

    $('#cityName').textContent = city;
    $('#cityTagline').textContent = city === '线上' ? '线上 / 全球赛事' : `${city} AI 活动地图`;
    $('#cityCount').innerHTML = `<b>${list.length}</b><span>场进行中/即将开始</span>`;
    $('#cityHero').dataset.count = list.length;
    // 折叠状态下的细条内容
    $('#heroMiniName').textContent = city;
    $('#heroMiniSub').textContent = `${list.length} 场即将开始 · 共 ${all.length} 场收录`;
    $('#cityStats').innerHTML = `
      <div class="hero-stat"><b>${all.length}</b><span>活动总数</span></div>
      <div class="hero-stat"><b>${upcoming.length}</b><span>即将开始</span></div>
      <div class="hero-stat"><b>${hacks}</b><span>黑客松</span></div>
      <div class="hero-stat"><b>${new Set(list.map((e) => e.venue)).size}</b><span>活动场地</span></div>`;

    renderCityBand(city, all, list, upcoming);

    // 卡片
    const el = $('#cityEvents');
    if (!list.length) {
      el.innerHTML = `<div class="empty" style="grid-column:1/-1">
        <div class="empty-emoji">🗓️</div>
        <p>暂无即将开始的${esc(city)}活动</p>
        <small>活动数据每日自动更新，可稍后再来看看</small>
      </div>`;
    } else {
      el.innerHTML = list.map((e) => evCard(e)).join('');
    }

    // 汇总表
    $('#citySummary').innerHTML = all
      .slice()
      .sort((a, b) => String(a.dateStart).localeCompare(String(b.dateStart)))
      .map((e, i) => `
        <div class="sum-row">
          <span class="sum-num">${i + 1}</span>
          <span class="sum-date">${esc(fmtRange(e))}</span>
          <span class="sum-title">${esc(e.title)}</span>
          <span class="sum-aud">${esc(e.audience || e.venue || '')}</span>
          <span class="badge badge-${e.type}">${TYPE_NAME[e.type] || ''}</span>
        </div>`).join('');

    bindCards();
  }

  /* ---------------- 城市速览总结 ---------------- */

  function renderCityBand(city, all, list, upcoming) {
    const isOnline = city === '线上';

    // 类型分布
    const typeCount = {};
    for (const e of all) typeCount[e.type] = (typeCount[e.type] || 0) + 1;

    // 场地分布（只统计真实场地）
    const venues = {};
    for (const e of all) {
      const v = (e.venue || '').trim();
      if (!v || v === '待定' || v === '线上') continue;
      venues[v] = (venues[v] || 0) + 1;
    }
    const topVenues = Object.entries(venues).sort((a, b) => b[1] - a[1]).slice(0, 3);

    // 人群分布
    const auds = new Set(all.map((e) => e.audience).filter(Boolean));
    // 主办方
    const hosts = new Set(all.map((e) => e.host).filter((h) => h && h.length > 1 && h.length < 30));

    // 时间跨度
    const sorted = all.slice().sort((a, b) => String(a.dateStart).localeCompare(String(b.dateStart)));
    const first = sorted[0] ? parseDate(sorted[0].dateStart) : null;
    const last = sorted[sorted.length - 1] ? parseDate(sorted[sorted.length - 1].dateStart) : null;
    const span = first && last && first !== last
      ? `${first.getMonth() + 1}月${first.getDate()}日 至 ${last.getMonth() + 1}月${last.getDate()}日`
      : (first ? `${first.getMonth() + 1}月${first.getDate()}日` : '待定');

    // 最近一场
    const next = upcoming.slice().sort((a, b) => daysUntil(a) - daysUntil(b))[0];
    const nextCd = next ? countdownText(next) : '';

    // 人群关键词
    const audienceTop = [...auds].slice(0, 3).map((a) => a.split(/\s*\/\s*/)[0].trim()).filter(Boolean);

    // 生成总结段落
    const parts = [];
    if (isOnline) {
      parts.push(`<b>${city}</b>共收录 <b>${all.length}</b> 场赛事，其中 <b>${typeCount.hackathon || 0}</b> 场为黑客松。这类活动通常面向全球开发者，线上参与、提交作品即可，无需到场。`);
    } else {
      parts.push(`<b>${city}</b>当前有 <b>${all.length}</b> 场 AI 活动，其中 <b>${typeCount.hackathon || 0}</b> 场是黑客松、<b>${typeCount.conference || 0}</b> 场是大会或峰会。活动集中在 <b>${span}</b>，`);

      if (next) {
        parts.push(`最近的一场是 <b>${esc(next.title)}</b>，<b>${nextCd}</b>。`);
      }
      if (topVenues.length) {
        const v = topVenues.map(([n, c]) => c > 1 ? `${esc(n)}（${c} 场）` : esc(n)).join('、');
        parts.push(`常驻场地包括 ${v}。`);
      } else {
        parts.push('多数活动的具体场地需在报名时确认。');
      }
      if (audienceTop.length) {
        parts.push(`主要面向 ${audienceTop.map(esc).join('、')} 等人群。`);
      }
      if (hosts.size) {
        const hs = [...hosts].slice(0, 2).map(esc).join('、');
        parts.push(`主办方包括 ${hs}${hosts.size > 2 ? ` 等 ${hosts.size} 家` : ''}。`);
      }
    }

    $('#bandText').innerHTML = parts.join('');

    // 标签
    const chips = [];
    for (const [type, n] of Object.entries(typeCount)) {
      chips.push(`<span class="band-chip">${TYPE_NAME[type] || type} ${n}</span>`);
    }
    if (isOnline) chips.push('<span class="band-chip">全球参与</span>');
    if (audienceTop.length) chips.push(`<span class="band-chip">${esc(audienceTop[0])}向</span>`);
    $('#bandChips').innerHTML = chips.join('');

    // 关键信息
    const facts = [];
    if (!isOnline) facts.push(['时间跨度', span]);
    facts.push(['最近一场', next ? `${esc(next.title.slice(0, 20))}（${nextCd}）` : '暂无']);
    facts.push(['活动总数', `${all.length} 场`]);
    facts.push(['黑客松', `${typeCount.hackathon || 0} 场`]);
    if (!isOnline && topVenues.length) facts.push(['主要场地', esc(topVenues[0][0])]);
    facts.push(['数据来源', `${new Set(all.map((e) => e.source).filter(Boolean)).size} 个来源`]);

    $('#bandFacts').innerHTML = facts.map(([k, v]) =>
      `<div class="fact-row"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`).join('');
  }

  function evCard(e) {
    const cd = countdownText(e);
    const d = daysUntil(e);
    const cls = d !== null && d <= 7 ? ' is-soon' : (d !== null && d < 0 ? ' is-past' : '');
    const start = parseDate(e.dateStart);
    const weekday = start ? `周${WEEKDAY[start.getDay()]}` : '';
    const summary = e.summary || e.desc || '';
    const points = (e.highlights || []).slice(0, 3);

    return `
      <article class="ev-card t-${e.type}" data-id="${esc(e.id)}">
        <div class="ev-card-top">
          <div class="ev-date-row">
            <span class="ev-date">${esc(fmtRange(e))}</span>
            ${weekday ? `<span class="ev-weekday">${weekday}</span>` : ''}
            ${e.highlight ? '<span class="badge badge-rec">推荐</span>' : ''}
            ${e.online ? '<span class="badge badge-online">线上</span>' : ''}
          </div>
          <h3 class="ev-title">${highlightTitle(e.title)}</h3>
          ${summary ? `<p class="ev-summary">${esc(summary)}</p>` : ''}
          ${points.length ? `<ul class="ev-points">${points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        </div>
        <div class="ev-meta">
          ${e.venue && e.venue !== '待定' ? `<div class="ev-row"><span class="ico">📍</span><span><b>场地</b> ${esc(e.venue)}</span></div>` : ''}
          ${e.audience ? `<div class="ev-row"><span class="ico">👥</span><span><b>适合</b> ${esc(e.audience)}</span></div>` : ''}
          ${e.host ? `<div class="ev-row"><span class="ico">🏛</span><span><b>主办</b> ${esc(e.host)}</span></div>` : ''}
          ${e.source ? `<div class="ev-row"><span class="ico">📡</span><span><b>来源</b> ${esc(sourceLabel(e.source))}</span></div>` : ''}
        </div>
        <div class="ev-foot">
          <span class="badge badge-${e.type}">${TYPE_NAME[e.type] || ''}</span>
          <span class="countdown-mini${cls}">${esc(cd)}</span>
          ${cardLink(e)}
          <button class="icon-btn ${isWatched(e.id) ? 'is-on' : ''}" data-watch="${esc(e.id)}" title="关注">${isWatched(e.id) ? '★' : '☆'}</button>
        </div>
      </article>`;
  }

  /**
   * 卡片右下角的操作链接。
   * 有原文链接 → 直接跳转；没有 → 用标题去必应搜索，保证每张卡都有可点的出口。
   */
  function cardLink(e) {
    if (e.url) {
      return `<a class="card-link" href="${esc(e.url)}" target="_blank" rel="noopener" title="${esc(e.title)}">报名/原文 ↗</a>`;
    }
    const q = encodeURIComponent(`${e.title} ${e.city} 报名`);
    return `<a class="card-link is-search" href="https://www.bing.com/search?q=${q}" target="_blank" rel="noopener" title="网上搜索该活动">搜索详情 ↗</a>`;
  }

  /** 标题里的关键词高亮 */
  function highlightTitle(title) {
    const t = esc(title);
    return t.replace(/(AI|人工智能|大模型|黑客松|开发者大会|智能体|Agent|LLM)/gi, '<mark>$1</mark>');
  }

  /** 来源名称友好化 */
  function sourceLabel(src) {
    const map = {
      海报: '官方海报',
      示例: '示例数据',
      '搜狗微信 · 公众号': '微信公众号',
      '必应搜索 · AI 黑客松': '公开搜索',
      '必应搜索 · 小红书 AI 活动': '小红书',
      '必应搜索 · 抖音 AI 活动': '抖音',
      '必应搜索 · AI 峰会/大会': '公开搜索',
      'AI Competition Radar': '赛事雷达',
    };
    return map[src] || src;
  }

  /** 数据来源数量 */
  function sourceCount() {
    return new Set(state.events.map((e) => e.source).filter(Boolean)).size;
  }

  function bindCards() {
    $$('#cityEvents .ev-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        // 链接和关注按钮不触发详情弹窗
        if (e.target.closest('[data-watch]') || e.target.closest('a.card-link')) return;
        openModal(card.dataset.id);
      });
    });
    $$('[data-watch]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleWatch(b.dataset.watch);
        renderCityPage();
        renderWatch();
        renderCalendar();
      });
    });
  }

  /* ---------------- 活动详情弹窗 ---------------- */

  function openModal(id) {
    const e = state.events.find((x) => x.id === id);
    if (!e) return;
    const s = parseDate(e.dateStart);
    const d = daysUntil(e);
    const diff = d === null ? null : d;
    const body = $('#modalBody');

    let cdHtml = '';
    if (s) {
      const past = diff < 0;
      const cd = past ? '已开始' : (diff === 0 ? '今天开始' : `${diff} 天后`);
      cdHtml = `
        <div class="dt-count ${past ? 'is-past' : (diff <= 7 ? 'is-soon' : '')}">
          <b>${past ? '已开始' : diff}</b>
          <span>${past ? esc(cd) : '天后开始 · ' + esc(fmtFull(s))}</span>
        </div>`;
    }

    body.innerHTML = `
      <span class="badge badge-${e.type} dt-type">${TYPE_NAME[e.type] || ''}${e.online ? ' · 线上' : ''}</span>
      <h2 class="dt-title" id="modalTitle">${esc(e.title)}</h2>
      ${cdHtml}
      <div class="dt-rows">
        <div class="dt-row"><span class="ico">📅</span><span><b>时间：</b><span class="val">${esc(fmtFull(s))}${e.dateEnd && e.dateEnd !== e.dateStart ? ' ~ ' + esc(fmtFull(parseDate(e.dateEnd))) : ''}</span></span></div>
        ${e.venue ? `<div class="dt-row"><span class="ico">📍</span><span><b>场地：</b><span class="val">${esc(e.venue)}</span></span></div>` : ''}
        ${e.audience ? `<div class="dt-row"><span class="ico">👥</span><span><b>适合人群：</b><span class="val">${esc(e.audience)}</span></span></div>` : ''}
        ${e.host ? `<div class="dt-row"><span class="ico">🏛</span><span><b>主办方：</b><span class="val">${esc(e.host)}</span></span></div>` : ''}
        ${e.source ? `<div class="dt-row"><span class="ico">📡</span><span><b>来源：</b><span class="val">${esc(sourceLabel(e.source))}</span></span></div>` : ''}
      </div>
      ${e.content || e.desc || e.summary ? `<div class="dt-desc" id="dtDesc">${esc(e.content || e.desc || e.summary)}</div>` : ''}
      ${(e.highlights || []).length ? `
        <div class="dt-points">
          <h4>活动要点</h4>
          <ul>${e.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
        </div>` : ''}
      <div class="dt-actions">
        ${e.url
          ? `<a class="btn btn-primary" href="${esc(e.url)}" target="_blank" rel="noopener">报名/查看原文 ↗</a>`
          : `<a class="btn btn-primary" href="https://www.bing.com/search?q=${encodeURIComponent(`${e.title} ${e.city} 报名`)}" target="_blank" rel="noopener">搜索报名方式 ↗</a>`}
        <button class="btn" data-modal-watch="${esc(e.id)}">${isWatched(e.id) ? '★ 取消关注' : '☆ 关注此活动'}</button>
      </div>
      ${e.sourceUrl && e.sourceUrl !== e.url ? `<div class="dt-source">原文：<a href="${esc(e.sourceUrl)}" target="_blank" rel="noopener">${esc(e.sourceUrl.slice(0, 60))}</a></div>` : ''}
    `;

    $('#eventModal').hidden = false;

    const wb = body.querySelector('[data-modal-watch]');
    if (wb) {
      wb.addEventListener('click', () => {
        toggleWatch(e.id);
        openModal(id);
        renderWatch();
        renderCalendar();
        renderCityPage();
      });
    }
  }

  function closeModal() {
    $('#eventModal').hidden = true;
    $('#customModal').hidden = true;
    $('#articleModal').hidden = true;
  }

  /* ---------------- 日历 ---------------- */

  function renderCalendar() {
    const list = $('#calendarList');
    const filter = state.calFilter;

    let items = state.events.slice();
    if (filter === 'mine') {
      items = items.filter((e) => isWatched(e.id));
    } else if (filter !== 'all') {
      items = items.filter((e) => e.type === filter);
    }

    if (!items.length) {
      list.innerHTML = `<div class="empty">
        <div class="empty-emoji">📭</div>
        <p>${filter === 'mine' ? '还没有关注任何活动' : '该分类下暂无活动'}</p>
        <small>${filter === 'mine' ? '在活动卡片上点击 ☆ 即可加入关注' : '数据每日自动更新'}</small>
      </div>`;
      return;
    }

    // 视图模式：月历表格 / 列表卡片（记住用户选择）
    state.calMode = localStorage.getItem('calMode') === 'list' ? 'list' : 'month';
    const mode = state.calMode;

    let body = '';
    let navTitle = '';

    if (mode === 'month') {
      // ---- 月历表格 ----
      if (!state.calMonth) {
        const now = new Date();
        state.calMonth = { y: now.getFullYear(), m: now.getMonth() };
      }
      const { y, m } = state.calMonth;

      // 把活动铺到月的每一天（跨天活动每天都出现）
      const byDay = {};
      const noDate = [];
      for (const e of items) {
        const s = parseDate(e.dateStart);
        if (!s) { noDate.push(e); continue; }
        const end = parseDate(e.dateEnd) || s;
        for (let d = new Date(s); d <= end; d.setDate(d.getDate() + 1)) {
          if (d.getFullYear() === y && d.getMonth() === m) {
            (byDay[d.getDate()] = byDay[d.getDate()] || []).push(e);
          }
        }
      }

      const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`;
      const first = new Date(y, m, 1);
      const offset = (first.getDay() + 6) % 7; // 周一开头
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const now = new Date();
      const isThisMonth = now.getFullYear() === y && now.getMonth() === m;
      const sortedKeys = [...new Set(items.map((e) => (e.dateStart || '').slice(0, 7)))].sort();
      const canPrev = monthKey > sortedKeys[0];
      const canNext = monthKey < sortedKeys[sortedKeys.length - 1];

      let cells = '';
      for (let i = 0; i < offset; i++) cells += '<div class="cal-cell is-blank"></div>';
      for (let day = 1; day <= daysInMonth; day++) {
        const evs = (byDay[day] || []).sort((a, b) => String(a.dateStart).localeCompare(String(b.dateStart)));
        const isToday = isThisMonth && now.getDate() === day;
        cells += `
          <div class="cal-cell${isToday ? ' is-today' : ''}">
            <div class="cal-day">${day}${isToday ? '<span class="cal-today-tag">今天</span>' : ''}</div>
            <div class="cal-evs">${evs.map((e) => {
              const isStart = (e.dateStart || '').slice(0, 10) === `${monthKey}-${String(day).padStart(2, '0')}`;
              return `<button class="cal-ev t-${e.type}${isStart ? '' : ' is-cont'}" data-id="${esc(e.id)}"
                title="${esc(e.title)} · ${esc(e.city)}${e.venue && e.venue !== '待定' ? ' · ' + esc(e.venue) : ''}">
                ${highlightTitle(e.title)}</button>`;
            }).join('')}</div>
          </div>`;
      }

      navTitle = `${y} 年 ${m + 1} 月${isThisMonth ? ' · 本月' : ''}`;
      body = `
        <div class="cal-month">
          <div class="cal-dow">周一</div><div class="cal-dow">周二</div><div class="cal-dow">周三</div>
          <div class="cal-dow">周四</div><div class="cal-dow">周五</div><div class="cal-dow">周六</div>
          <div class="cal-dow is-weekend">周日</div>
          ${cells}
        </div>
        ${noDate.length ? `
          <div class="cal-undated">
            <h3>日期待定（${noDate.length} 场）</h3>
            ${noDate.map(calItem).join('')}
          </div>` : ''}
        <p class="cal-hint">💡 点击格子里的活动名可看详情；跨天的活动会在每一天都出现</p>
      `;

      setTimeout(() => {
        $('#calPrev')?.addEventListener('click', () => {
          state.calMonth = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 };
          renderCalendar();
        });
        $('#calNext')?.addEventListener('click', () => {
          state.calMonth = m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 };
          renderCalendar();
        });
        $('#calBack')?.addEventListener('click', () => {
          state.calMonth = { y: now.getFullYear(), m: now.getMonth() };
          renderCalendar();
        });
      }, 0);
    } else {
      // ---- 列表卡片（按日期分组） ----
      const groups = {};
      for (const e of items) {
        const key = (e.dateStart || '未定').slice(0, 10);
        (groups[key] = groups[key] || []).push(e);
      }
      const keys = Object.keys(groups).sort((a, b) => a.localeCompare(b));
      navTitle = `全部活动 · ${items.length} 场`;
      body = keys.map((key) => {
        const s = parseDate(key);
        const dayLabel = s ? `${s.getFullYear()} 年 ${s.getMonth() + 1} 月 ${s.getDate()} 日 周${WEEKDAY[s.getDay()]}` : '日期待定';
        const items2 = groups[key].sort((a, b) => String(a.dateStart).localeCompare(String(b.dateStart)));
        return `
          <div class="cal-group">
            <div class="cal-group-head">
              <b>${esc(dayLabel)}</b>
              <span>${items2.length} 场</span>
            </div>
            ${items2.map(calItem).join('')}
          </div>`;
      }).join('');
    }

    list.innerHTML = `
      <div class="cal-nav">
        <div class="cal-mode">
          <button class="chip${mode === 'month' ? ' is-active' : ''}" data-cmode="month">月历</button>
          <button class="chip${mode === 'list' ? ' is-active' : ''}" data-cmode="list">列表</button>
        </div>
        <h2 class="cal-month-title">${esc(navTitle)}</h2>
        ${mode === 'month' ? `
          <button class="btn" id="calPrev">◀ 上个月</button>
          <button class="btn" id="calNext">下个月 ▶</button>
          ${/本月/.test(navTitle) ? '' : '<button class="btn btn-primary" id="calBack">回到本月</button>'}` : ''}
      </div>
      ${body}`;

    $$('#calendarList [data-cmode]').forEach((b) => {
      b.addEventListener('click', () => {
        localStorage.setItem('calMode', b.dataset.cmode);
        renderCalendar();
      });
    });

    $$('#calendarList .cal-ev').forEach((b) => {
      b.addEventListener('click', () => openModal(b.dataset.id));
    });
    $$('#calendarList .cal-item').forEach((it) => {
      it.addEventListener('click', (e) => {
        if (e.target.closest('[data-watch]')) return;
        openModal(it.dataset.id);
      });
    });
    $$('#calendarList [data-watch]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleWatch(b.dataset.watch);
        renderCalendar();
        renderWatch();
      });
    });
  }

  function calItem(e) {
    const d = daysUntil(e);
    const dn = d === null
      ? `<div class="dn"><b>--</b><span>待定</span></div>`
      : d < 0
        ? `<div class="dn is-past"><b>${d}</b><span>天前</span></div>`
        : d === 0
          ? `<div class="dn is-today"><b>今天</b><span>开始</span></div>`
          : `<div class="dn"><b>${d}</b><span>天后</span></div>`;

    return `
      <div class="cal-item" data-id="${esc(e.id)}">
        ${dn}
        <div class="cal-main">
          <div class="cal-title">${highlightTitle(e.title)}</div>
          ${e.summary ? `<div class="cal-summary">${esc(e.summary)}</div>` : ''}
          <div class="cal-meta">
            <span>📍 ${esc(e.city)}${e.venue && e.venue !== '待定' && e.venue !== '线上' ? ' · ' + esc(e.venue) : ''}</span>
            <span class="badge badge-${e.type}">${TYPE_NAME[e.type] || ''}</span>
            ${e.highlight ? '<span class="badge badge-rec">推荐</span>' : ''}
          </div>
        </div>
        <div class="cal-right">
          ${e.url ? `<a class="btn" href="${esc(e.url)}" target="_blank" rel="noopener">原文 ↗</a>` : ''}
          <button class="icon-btn ${isWatched(e.id) ? 'is-on' : ''}" data-watch="${esc(e.id)}">${isWatched(e.id) ? '★' : '☆'}</button>
        </div>
      </div>`;
  }

  /* ---------------- 我的关注 ---------------- */

  function renderWatch() {
    const grid = $('#watchGrid');
    const evs = state.events.filter((e) => isWatched(e.id));
    const cards = [];

    // 自定义倒计时
    for (const c of state.customs) {
      const s = parseDate(c.date);
      const d = s ? daysBetween(s) : null;
      const cls = d === null ? '' : (d < 0 ? ' is-past' : (d <= 7 ? ' is-soon' : ''));
      cards.push(`
        <div class="watch-card is-custom">
          <div class="watch-card-head">
            <div class="watch-type">自定义倒计时</div>
            <div class="watch-title">${esc(c.title)}</div>
            <div class="watch-date">${c.note ? esc(c.note) + ' · ' : ''}${s ? esc(fmtFull(s)) : esc(c.date)}</div>
          </div>
          <div class="big-count${cls}">
            <b>${d === null ? '--' : (d < 0 ? '已过' : d)}</b>
            <span>${d === null ? '' : (d < 0 ? '天前' : '天后')}</span>
          </div>
          <div class="watch-foot">
            <button class="icon-btn" data-del-custom="${esc(c.id)}" title="删除">×</button>
          </div>
        </div>`);
    }

    // 关注的活动
    for (const e of evs) {
      const d = daysUntil(e);
      const cls = d === null ? '' : (d < 0 ? ' is-past' : (d <= 7 ? ' is-soon' : ''));
      cards.push(`
        <div class="watch-card" data-open="${esc(e.id)}" style="cursor:pointer">
          <div class="watch-card-head">
            <div class="watch-type">${TYPE_NAME[e.type] || ''} · ${esc(e.city)}</div>
            <div class="watch-title">${highlightTitle(e.title)}</div>
            <div class="watch-date">${esc(fmtRange(e))}${e.venue && e.venue !== '待定' && e.venue !== '线上' ? ' · ' + esc(e.venue) : ''}</div>
            ${e.summary ? `<div class="watch-date" style="margin-top:7px;color:var(--ink-3);font-weight:500;line-height:1.6">${esc(e.summary.slice(0, 90))}${e.summary.length > 90 ? '…' : ''}</div>` : ''}
          </div>
          <div class="big-count${cls}">
            <b>${d === null ? '--' : (d < 0 ? '已开始' : d)}</b>
            <span>${d === null ? '日期待定' : (d < 0 ? '' : '天后开始')}</span>
          </div>
        </div>`);
    }

    if (!cards.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
        <div class="empty-emoji">⭐</div>
        <p>还没有关注任何活动</p>
        <small>在活动卡片上点击 ☆ 关注，或添加自定义倒计时</small>
      </div>`;
      return;
    }

    grid.innerHTML = cards.join('');

    $$('#watchGrid [data-open]').forEach((c) => {
      c.addEventListener('click', () => openModal(c.dataset.open));
    });
    $$('#watchGrid [data-del-custom]').forEach((b) => {
      b.addEventListener('click', () => {
        state.customs = state.customs.filter((c) => c.id !== b.dataset.delCustom);
        saveLocal('customs', state.customs);
        renderWatch();
        updateBadge();
      });
    });
  }

  /* ---------------- 视图切换 ---------------- */

  function switchView(view) {
    state.view = view;
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-' + view));
    $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
    if (view === 'map') renderMap();
    if (view === 'calendar') renderCalendar();
    if (view === 'watching') renderWatch();
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindUI() {
    $$('.tab').forEach((t) => {
      t.addEventListener('click', () => {
        if (t.dataset.view === 'city') { switchView('map'); return; }
        switchView(t.dataset.view);
      });
    });

    $('#cityBack').addEventListener('click', () => switchView('map'));

    // 头部海报区折叠/展开（默认收起，记住用户选择）
    const applyHeroState = () => {
      const collapsed = localStorage.getItem('heroCollapsed') !== '0';
      $('#cityHero').classList.toggle('is-collapsed', collapsed);
      const btn = $('#heroToggle');
      btn.textContent = collapsed ? '展开头部 ▼' : '收起头部 ▲';
      btn.setAttribute('aria-expanded', String(!collapsed));
    };
    applyHeroState();
    $('#heroToggle').addEventListener('click', () => {
      const next = $('#cityHero').classList.contains('is-collapsed') ? '0' : '1';
      localStorage.setItem('heroCollapsed', next);
      applyHeroState();
    });

    $('#cityFilter').addEventListener('input', (e) => {
      state.filterText = e.target.value;
      renderCityList();
    });

    $('#onlyUpcoming').addEventListener('change', (e) => {
      state.onlyUpcoming = e.target.checked;
      renderCityPage();
    });

    $$('#calFilters .chip').forEach((c) => {
      c.addEventListener('click', () => {
        $$('#calFilters .chip').forEach((x) => x.classList.remove('is-active'));
        c.classList.add('is-active');
        state.calFilter = c.dataset.type;
        renderCalendar();
      });
    });

    // 弹窗关闭
    $$('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    // 自定义倒计时
    $('#addCustomBtn').addEventListener('click', () => {
      $('#customModal').hidden = false;
      $('#customForm').reset();
    });

    $('#customForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const title = String(fd.get('title') || '').trim();
      const date = String(fd.get('date') || '').trim();
      const note = String(fd.get('note') || '').trim();
      if (!title || !date) return;
      state.customs.push({
        id: 'c' + Date.now().toString(36),
        title, date, note,
      });
      saveLocal('customs', state.customs);
      closeModal();
      updateBadge();
      renderWatch();
    });

    // 每分钟刷新倒计时
    setInterval(() => {
      if (state.view === 'calendar') renderCalendar();
      else if (state.view === 'watching') renderWatch();
      else if (state.view === 'city' && state.city) renderCityPage();
    }, 60000);
  }

  /* ---------------- 启动 ---------------- */

  bindUI();
  loadData();
})();
