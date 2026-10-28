/**
 * 地图预处理：GeoJSON → 紧凑 SVG path
 * ------------------------------------------------------------
 * 把 china_100000_full.json（含 34 个省级行政区 + 南海诸岛九段线）
 * 投影到 Mercator 后转为 SVG path 字符串，输出到 data/map-paths.js。
 *
 * 排版遵循标准地图规范：
 *   - 主体陆地占大图（lat 17~54.5）
 *   - 南海诸岛（含九段线）单独作为右下角插图，标注"南海诸岛"
 *   - 完整保留台湾省与全国界
 *
 * 运行：node fetcher/build-map.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'china_100000_full.json');
const OUT = path.join(ROOT, 'data', 'map-paths.js');

/* ---------------- 投影 ---------------- */
function mercator(lon, lat) {
  const x = lon;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) / Math.PI;
  return [x, y];
}

/** 主体视图范围（不含南海诸岛） */
const MAIN = { LON_MIN: 73.0, LON_MAX: 136.5, LAT_MIN: 15.0, LAT_MAX: 54.5 };
/** 南海诸岛插图范围 */
const SOUTH = { LON_MIN: 106.0, LON_MAX: 123.5, LAT_MIN: 3.0, LAT_MAX: 24.0 };

const W = 1000, H = 700;
/** 南海插图在主画布上的位置与尺寸 */
const INSET = { x: 838, y: 500, w: 150, h: 146 };

function makeProjector(bounds, w, h) {
  const [x0, y0] = mercator(bounds.LON_MIN, bounds.LAT_MAX);
  const [x1, y1] = mercator(bounds.LON_MAX, bounds.LAT_MIN);
  return (lon, lat) => {
    const [x, y] = mercator(lon, lat);
    return [((x - x0) / (x1 - x0)) * w, ((y - y0) / (y1 - y0)) * h];
  };
}

const projMain = makeProjector(MAIN, W, H);
const projSouth = makeProjector(SOUTH, INSET.w, INSET.h);

function ringToPath(ring, proj, offset) {
  let d = '';
  let prev = null;
  let started = false;
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i];
    const [x, y] = proj(lon, lat);
    const r = Math.round((x + (offset ? offset.x : 0)) * 10) / 10;
    const yy = Math.round((y + (offset ? offset.y : 0)) * 10) / 10;
    if (!started) { d += `M${r},${yy}`; started = true; }
    else {
      // 简化：跳过与前一点距离过近的点
      const dx = r - prev[0], dy = yy - prev[1];
      if (dx * dx + dy * dy < 0.3) continue;
      d += `L${r},${yy}`;
    }
    prev = [r, yy];
  }
  return d + 'Z';
}

function geomToPath(geom, proj, offset) {
  if (!geom) return '';
  if (geom.type === 'Polygon') {
    return geom.coordinates.map((r) => ringToPath(r, proj, offset)).join('');
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.map((poly) => poly.map((r) => ringToPath(r, proj, offset)).join('')).join('');
  }
  return '';
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('✗ 缺少 data/china_100000_full.json');
    process.exit(1);
  }
  const gj = JSON.parse(fs.readFileSync(SRC, 'utf8'));

  const provinces = [];
  const southPolys = [];
  const insetProvinces = [];

  for (const f of gj.features) {
    const name = f.properties.name || '';
    const adcode = f.properties.adcode;

    if (adcode === '100000_JD') {
      // 南海诸岛：拆成两部分
      //   ① 海南岛本身 → 属于主体（海南省另算）
      //   ② 九段线与南沙等 → 插图
      southPolys.push(f.geometry);
      continue;
    }

    // 海南省的岛屿部分（南沙群岛在海南省内）需拆分处理
    if (name === '海南省') {
      // 海南省 = 海南岛（主体）+ 南海诸岛（插图）
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const hainanMain = [];
      const hainanIslands = [];
      for (const poly of polys) {
        // 判断是否在主体纬度范围内（海南岛主岛）
        let latSum = 0, n = 0;
        for (const ring of poly) for (const pt of ring) { latSum += pt[1]; n++; }
        const avgLat = n ? latSum / n : 0;
        if (avgLat > 17) hainanMain.push(poly); else hainanIslands.push(poly);
      }
      if (hainanMain.length) {
        insetProvinces.push; // no-op
        provinces.push({
          name,
          adcode,
          d: hainanMain.map((poly) => poly.map((r) => ringToPath(r, projMain, null)).join('')).join(''),
        });
      }
      // 其余岛屿画到插图
      if (hainanIslands.length) {
        insetProvinces.push({
          name,
          adcode,
          d: hainanIslands.map((poly) => poly.map((r) => ringToPath(r, projSouth, INSET)).join('')).join(''),
        });
      }
      continue;
    }

    const d = geomToPath(f.geometry, projMain, null);
    if (!d) continue;
    provinces.push({ name, adcode, d });
  }

  // 九段线 → 插图
  let southSea = '';
  for (const geom of southPolys) {
    if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        southSea += poly.map((r) => ringToPath(r, projSouth, INSET)).join('');
      }
    } else if (geom.type === 'Polygon') {
      southSea += geom.coordinates.map((r) => ringToPath(r, projSouth, INSET)).join('');
    }
  }

  const payload = {
    width: W,
    height: H,
    viewBox: `0 0 ${W} ${H}`,
    provinces,
    inset: {
      ...INSET,
      provinces: insetProvinces,
      southSea,
      label: '南海诸岛',
    },
    // 供前端换算城市坐标：主图投影参数
    proj: { ...MAIN, w: W, h: H },
  };

  const js = `/* 中国地图路径数据（自动生成，请勿手改）
 * 源: geo.datav.aliyun.com 标准行政区划边界（含南海诸岛九段线）
 * 排版: 主体大图 + 南海诸岛插图（右下角）
 * 生成: node fetcher/build-map.js
 */
window.MAP_PATHS = ${JSON.stringify(payload)};
`;
  fs.writeFileSync(OUT, js, 'utf8');

  const size = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`✔ ${provinces.length} 个省级行政区 + 南海诸岛插图 → ${OUT} (${size} KB)`);
  console.log(`  主体: lon ${MAIN.LON_MIN}~${MAIN.LON_MAX}, lat ${MAIN.LAT_MIN}~${MAIN.LAT_MAX}, 画布 ${W}×${H}`);
  console.log(`  插图: ${INSET.w}×${INSET.h} @ (${INSET.x},${INSET.y})`);
}

main();
