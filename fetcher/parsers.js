/**
 * 活动字段识别规则（共用模块）
 * ------------------------------------------------------------
 * fetch.js（HTTP 抓取）与 merge-browser.js（浏览器抓取）共用同一套
 * 识别逻辑，保证两条数据管线的产出格式一致。
 */

/* ---------------- 城市 ---------------- */

const CITY_LIST = [
  '北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '西安', '南京', '合肥',
  '重庆', '天津', '苏州', '青岛', '长沙', '郑州', '大连', '宁波', '厦门', '福州',
  '济南', '无锡', '昆明', '沈阳', '哈尔滨', '长春', '石家庄', '太原', '南宁',
  '贵阳', '兰州', '南昌', '珠海', '中山', '佛山', '东莞', '惠州', '常州', '温州',
  '嘉兴', '绍兴', '台州', '烟台', '潍坊', '洛阳', '襄阳', '芜湖',
  '保定', '廊坊', '秦皇岛', '唐山', '徐州', '南通', '扬州', '盐城', '淮安', '连云港',
  '金华', '衢州', '舟山', '赣州', '九江', '株洲', '湘潭', '衡阳', '岳阳',
  '包头', '赤峰', '呼和浩特', '银川', '西宁', '拉萨', '乌鲁木齐', '珠海',
  '前海', '横琴', '雄安', '浦东', '临港', '张江', '漕河泾', '中关村',
  '望京', '亦庄', '西二旗', '未来科技城', '南山', '坂田', '天河北', '琶洲',
  '珠江新城', '科学城', '高新区', '软件园', '五角场', '海��',
];

const CITY_ALIAS = {
  '北上广深': '北京', '北上广': '北京',
  shanghai: '上海', beijing: '北京', shenzhen: '深圳', guangzhou: '广州',
  hangzhou: '杭州', chengdu: '成都', nanjing: '南京', wuhan: '武汉',
  xian: '西安', "xi'an": '西安',
};

/** 园区/商圈 → 标准城市 */
const CITY_NORMALIZE = {
  中关村: '北京', 望京: '北京', 亦庄: '北京', 西二旗: '北京', 海淀: '北京',
  朝阳: '北京', 浦东: '上海', 张江: '上海', 漕河泾: '上海', 临港: '上海',
  五角场: '上海', 徐汇: '上海', 黄浦: '上海', 静安: '上海', 闵行: '上海',
  长宁: '上海', 杨浦: '上海', 嘉定: '上海', 松江: '上海', 宝山: '上海',
  南山: '深圳', 坂田: '深圳', 福田: '深圳', 罗湖: '深圳', 宝安: '深圳', 龙岗: '深圳',
  天河北: '广州', 琶洲: '广州', 珠江新城: '广州', 越秀: '广州', 白云: '广州',
  未来科技城: '杭州', 滨江: '杭州', 余杭: '杭州', 西湖: '杭州', 钱塘: '杭州',
  科学城: '成都', 高新区: '成都', 武侯: '成都', 天府: '成都',
  光谷: '武汉', 东湖: '武汉', 江汉: '武汉',
  经开区: '西安', 高新区: '西安', 雁塔: '西安',
  中新: '苏州', 园区: '苏州', 工业园: '苏州', 独墅湖: '苏州',
  滨海: '天津', 两江: '重庆', 江北: '重庆', 渝北: '重庆',
  前海: '深圳', 横琴: '珠海', 南沙: '广州', 雄安: '雄安',
};

function detectCity(text) {
  if (!text) return null;
  const t = String(text);
  const lower = t.toLowerCase();

  for (const [alias, city] of Object.entries(CITY_ALIAS)) {
    if (lower.includes(alias.toLowerCase())) return city;
  }
  // 园区/商圈优先于城市列表
  const aliases = Object.keys(CITY_NORMALIZE).sort((a, b) => b.length - a.length);
  for (const a of aliases) {
    if (t.includes(a)) return CITY_NORMALIZE[a];
  }
  // 标准城市名，长者优先
  const sorted = [...CITY_LIST].sort((a, b) => b.length - a.length);
  for (const c of sorted) {
    if (t.includes(c)) return c;
  }
  return null;
}

/* ---------------- 日期 ---------------- */

function cnNum(s) {
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (map[s]) return map[s];
  if (s.startsWith('十')) return 10 + (map[s[1]] || 0);
  if (s.includes('十')) {
    const [a, b] = s.split('十');
    return (map[a] || 0) * 10 + (b ? map[b] || 0 : 0);
  }
  return null;
}

function iso(y, m, d) {
  if (!y || !m || !d) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 推断年份：若该日期已过去（严格早于今天），视为次年 */
function inferYear(mo, d, now) {
  if (!mo || !d) return null;
  const cand = iso(now.getFullYear(), mo, d);
  if (!cand) return null;
  // 今天当天仍算今年
  const today = iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
  if (cand < today) {
    return iso(now.getFullYear() + 1, mo, d) || cand;
  }
  return cand;
}

function parseDate(text, now = new Date()) {
  if (!text) return null;
  const t = String(text);

  // "活动时间:11月7日09:00 - 11月8日18:00" 这类明确区间
  const rm = t.match(/(?:活动|举办|开始)?时间\s*[:：]?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*\d{1,2}[:：]\d{2})?\s*[-—~–至到]\s*(?:(\d{1,2})\s*月)?\s*(\d{1,2})\s*日/);
  if (rm) {
    const mo = +rm[1], d = +rm[2];
    const em = rm[3] ? +rm[3] : mo;
    const ed = +rm[4];
    const start = inferYear(mo, d, now);
    const end = inferYear(em, ed, now);
    if (start && end && end >= start) return { start, end };
  }

  // 完整日期
  let m = t.match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
  if (m) {
    const r = iso(+m[1], +m[2], +m[3]);
    if (r) return r;
  }

  // M月D日
  m = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) {
    const s = inferYear(+m[1], +m[2], now);
    if (s) return s;
  }

  // 中文月份
  m = t.match(/([一二三四五六七八九十]{1,3})月\s*([一二三四五六七八九十]{1,3})日/);
  if (m) {
    const mo = cnNum(m[1]), d = cnNum(m[2]);
    if (mo && d) {
      const s = inferYear(mo, d, now);
      if (s) return s;
    }
  }

  // M/D 格式（活动行等）："11/04 周三 ~ 11/05 周四"
  m = t.match(/(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*周[一二三四五六日])?(?:\s*[-—~–至到]\s*(?:(\d{1,2})\s*\/\s*)?(\d{1,2})\s*(?:周[一二三四五六日])?)?/);
  if (m) {
    const mo = +m[1], d = +m[2];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const start = inferYear(mo, d, now);
      let end = '';
      if (m[4]) {
        const em = m[3] ? +m[3] : mo;
        end = inferYear(em, +m[4], now);
      }
      return end && end >= start ? { start, end } : start;
    }
  }

  // 完整日期区间
  m = t.match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?\s*[-—~至到\-]\s*(?:(20\d{2})\s*[-/.年])?\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (m) {
    const start = iso(+m[1], +m[2], +m[3]);
    const end = iso(m[4] ? +m[4] : +m[1], +m[5], +m[6]);
    if (start && end) return { start, end };
  }
  return null;
}

/* ---------------- 场地 / 人群 ---------------- */

function detectVenue(text) {
  if (!text) return '';
  const t = String(text);
  const patterns = [
    /(?:活动地点|举办地点|地点|场地|会场|地址)[:：]\s*([^\s，,。;；|｜\n]{2,40})/,
    /(?:在|于)\s*([^\s，,。;；|｜\n]{2,40}?)(?:举办|举行|召开)/,
    /(?:场馆|酒店|中心|大厦|广场|园区|基地|小镇|空间|会堂|展览馆|会展中心|会议中心|大楼)([^\s，,。;；|｜\n]{0,20})/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m && m[1]) {
      let v = m[1].trim().replace(/[，,。.；;：:]+$/, '').replace(/\.{2,}$/, '').replace(/[，,、]$/, '');
      // 去掉被截断的残缺尾巴（"同济大.." / "张江.."）
      v = v.replace(/\.{2,}$/, '');
      // 过滤明显不完整的
      if (v.length >= 3 && v.length <= 40 && !/^第|^\d+$|^[\u4e00-\u9fa5]{1,2}$/.test(v)) return v;
    }
  }
  return '';
}

/** 无实际场地信息的占位文本 */
const VENUE_PLACEHOLDER = /具体地址以|以报名通知为准|待定|见报名|详见|另行通知|待公布|^线上$|^全国$/;

/** 判断场地是否为占位信息（展示时归一为"待定"） */
function isRealVenue(v) {
  if (!v) return false;
  if (VENUE_PLACEHOLDER.test(v)) return false;
  if (v.length < 3) return false;
  return true;
}

function detectAudience(text) {
  if (!text) return '';
  const t = String(text);
  const m = t.match(/(?:适合人群|面向人群|参与者|目标人群|面向)[:：]?\s*([^\s，,。|｜\n]{2,40})/);
  return m ? m[1].trim() : '';
}

/* ---------------- 类型 / 标题 ---------------- */

function detectType(title, desc) {
  const t = `${title} ${desc}`;
  if (/黑客松|hackathon|hack\s*week|黑客马拉松|编程马拉松/i.test(t)) return 'hackathon';
  if (/沙龙|salon|workshop|工作坊|训练营|bootcamp|共创工作坊/i.test(t)) return 'salon';
  if (/meetup|聚会|线下活动|交流活动|社区/i.test(t)) return 'meetup';
  if (/大会|峰会|论坛|年会|会展|发布会|conference|summit|大会|live/i.test(t)) return 'conference';
  return 'conference';
}

const TYPE_CLEAN = [
  [/^(分享|独家|重磅|突发|最新|快讯|干货|深度|原创|首发|独家专访)[:：\s]*/g, ''],
  [/^[\[【(（][^\]】)）]{1,12}[\]】)）]\s*/g, ''],
];

const TITLE_TAIL_NOISE = [
  /\s*[-—|｜]?\s*活动\s*报名\s*$/,
  /\s*[-—|｜]?\s*报名\s*$/,
  /\s*[-—|｜]?\s*报名\s*(启动|开启|正式启动|火热开启|通道开启)\s*$/,
  /\s*[-—|｜]?\s*(正式)?(启动|开启|报名中|火热报名|限时报名|报名通道开启)\s*$/,
  /\s*[-—|｜]?\s*正在报名\s*$/,
  /\s*[-—|｜]?\s*等\s*\d+\s*项活动正在报名\s*$/,
  /\s*[-—|｜]?\s*\d+\s*项活动正在\s*报名\s*$/,
  // 尾部/头部的报名截止等营销语
  /\s*[,，]?\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*报名截止\s*$/,
  /\s*[,，]?\s*报名截止\s*$/,
  /\s*[,，]?\s*邀你共创\s*$/,
];

/** 营销语片段：连同前置标点一起删除 */
const TITLE_NOISE_FRAGMENTS = [
  /\s*[,，]\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*报名截止/g,
  /\s*[,，]\s*招约[^，,。]{0,20}/g,
  /\s*[,，]\s*邀你共创/g,
  /\s*[,，]\s*仅剩\s*\d+\s*[个位]?\s*名额/g,
  /\s*[,，]\s*名额有限/g,
  /\s*[,，]\s*现场报名/g,
  /\s*[,，]\s*扫码报名/g,
  /\s*[,，]\s*限额报名/g,
  /\s*[,，]\s*火热招募中/g,
  /\s*[,，]\s*正在报名中/g,
  /\s*[,，]\s*早鸟票[^，,。]{0,12}/g,
  /\s*[,，]\s*火热报名中/g,
  // "等4项活动正在报名中!" 这类尾巴
  /\s*等?\s*\d+\s*项活动正在\s*报名\s*中?\s*[!！]?$/g,
];

const PAST_NOISE = [
  '圆满举办', '圆满结束', '成功举办', '顺利举办', '圆满落幕', '精彩回顾',
  '获奖名单', '精彩瞬间', '回顾盘点', '已举办', '顺利落幕',
  '圆满收官', '闭幕式', '赛事回顾', '活动回顾',
  '大会回顾', '大会总结', '盘点', '综述',
];

const OLD_YEAR_RE = /(?:19|20)\d{2}\s*(?:vivo|华为|小米|苹果|OPPO|字节|腾讯|阿里)?[^，。|｜]{0,12}回顾/;

function cleanTitle(raw) {
  let t = String(raw || '').trim();
  for (const [re, rep] of TYPE_CLEAN) t = t.replace(re, rep);
  // 移除营销噪音片段
  for (const re of TITLE_NOISE_FRAGMENTS) t = t.replace(re, '');
  let changed = true;
  for (let i = 0; i < 3 && changed; i++) {
    changed = false;
    for (const re of TITLE_TAIL_NOISE) {
      const nt = t.replace(re, '');
      if (nt !== t) { t = nt; changed = true; }
    }
  }
  t = t.replace(/^活动\s*[|｜·\-—]?\s*/, '')
       .replace(/\s*[|｜]\s*活动\s*[|｜]?\s*/g, ' ')
       .replace(/\s*\|\s*$/, '')
       .trim();
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/[,，]\s*$/, '').trim();
  if (t.length > 60) t = t.slice(0, 60).replace(/[\s，,、。.|｜\-]+$/, '');
  return t;
}

function refineTitle(rawTitle, desc) {
  const t = cleanTitle(rawTitle);
  const parts = t.split(/\s*[|｜]\s*/).map((s) => s.trim()).filter(Boolean);
  const cands = parts.length > 1 ? parts : [t];

  const score = (s) => {
    let v = 0;
    if (/黑客松|hackathon|大会|峰会|论坛|沙龙|meetup|开发者日|训练营/i.test(s)) v += 5;
    if (/AI|人工智能|大模型|LLM|Agent/i.test(s)) v += 4;
    if (/报名|启动|开启/.test(s)) v -= 3;
    if (s.length >= 8 && s.length <= 40) v += 2;
    if (/^活动$|活动$/.test(s)) v -= 4;
    return v;
  };

  const best = cands.slice().sort((a, b) => score(b) - score(a))[0];
  const title = best && score(best) > 0 ? best : t;

  if (title.replace(/[^\u4e00-\u9fa5a-z0-9]/gi, '').length < 6 && desc) {
    const first = desc.split(/[。！？\n]/)[0].trim();
    if (first && first.length >= 8) return first.slice(0, 50);
  }
  return title;
}

function isPastEvent(title, desc) {
  const t = `${title} ${desc}`;
  return PAST_NOISE.some((k) => t.includes(k));
}

function slug(title) {
  return String(title).toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/* ---------------- 详情富化 ---------------- */

/** 从正文抽取要点（议程/亮点/适合人群等） */
const HIGHLIGHT_PATTERNS = [
  /(?:活动亮点|亮点|特色|看点)[:：]?\s*([^\n]{4,120})/,
  /(?:活动内容|内容介绍|活动介绍|简介)[:：]?\s*([^\n]{4,120})/,
  /(?:适合人群|面向人群|参与者|适合对象)[:：]?\s*([^\n]{2,60})/,
  /(?:主办方|主办单位|承办方|联合主办)[:：]?\s*([^\n]{2,40})/,
  /(?:报名方式|参与方式|报名入口|如何报名)[:：]?\s*([^\n]{2,60})/,
  /(?:议程|流程|日程|活动流程)[:：]?\s*([^\n]{4,150})/,
  /(?:奖金|奖励|奖金池)[:：]?\s*([^\n]{2,60})/,
  /(?:门票|费用|免费|费用)[:：]?\s*([^\n]{2,60})/,
];

function extractHighlights(text) {
  if (!text) return [];
  const out = [];
  const t = String(text).replace(/\s+/g, ' ');
  for (const re of HIGHLIGHT_PATTERNS) {
    const m = t.match(re);
    if (m && m[1]) {
      const v = m[1].trim().replace(/[。；;，,]$/, '');
      if (v.length >= 3 && v.length <= 160) out.push(v);
    }
  }
  return [...new Set(out)].slice(0, 6);
}

/**
 * 生成活动摘要：把散落的原始描述整理成一句可读的短介绍
 * 无正文时依据标题 + 场地 + 人群合成
 */
function buildSummary(ev) {
  const desc = (ev.desc || '').trim();
  const title = String(ev.title || '').trim();

  // 0. 摘要等于标题复述 → 不算有效摘要，走合成逻辑
  const titleCore = title.replace(/[\s·、,，|｜\-—]/g, '').slice(0, 12);
  const descCore = desc.replace(/[\s·、,，|｜\-—]/g, '').slice(0, 12);
  const isEcho = titleCore && descCore && (descCore.startsWith(titleCore.slice(0, 6)) || titleCore.startsWith(descCore.slice(0, 6)));

  // 1. 有正文：清洗掉噪音片段，保留完整语义
  if (desc.length >= 24 && !isEcho) {
    let s = desc
      .replace(/^[^\u4e00-\u9fa5A-Za-z0-9]*/, '')          // 去开头符号
      .replace(/\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*\d{1,2}[:：]\d{2})?/g, '')  // 去裸日期
      .replace(/活动时间[:：]?/g, '')
      .replace(/活动地点[:：]?/g, '')
      .replace(/报名时间[:：]?/g, '')
      .replace(/地点[:：]?\s*/g, '')
      .replace(/\s*\|\s*/g, '，')
      .replace(/[，,、]{2,}/g, '，')
      .replace(/^[，,、\s]+/, '')
      .replace(/[，,、\s]+$/, '')
      .trim();
    if (s.length >= 12) {
      return s.length > 150 ? s.slice(0, 150) + '…' : s;
    }
  }

  // 2. 聚合站赛事：按里程碑信息合成
  if (/提交截止|报名截止|作品提交|报名与作品|开放报名|截止/.test(desc)) {
    const label = (desc.match(/(提交截止|作品提交截止|报名与作品提交截止|报名截止|报名与作品截止)/) || [])[1] || '关键节点';
    const type = ev.type === 'hackathon' ? '黑客松' : 'AI 赛事';
    return `全球线上${type}，${label}节点见原文。注册账号后提交作品即可参与，通常不限国籍与地区。`;
  }

  // 3. 无正文：按类型合成一句
  const t = ev.type;
  const aud = String(ev.audience || '').trim();
  const who = aud ? `面向 ${aud.replace(/\s*\/\s*/g, '、')}` : '';
  const rawVenue = String(ev.venue || '').trim();
  const hasVenue = rawVenue && rawVenue !== '待定' && !VENUE_PLACEHOLDER.test(rawVenue);
  const where = hasVenue ? `在 ${rawVenue}` : '';
  const join = where && who ? '，' : (where || who ? '' : '');

  const map = {
    hackathon: `${where}${join}${who ? who + '的' : ''}限时编程挑战，组队开发、现场评审与评奖。`,
    conference: `${where}${join}${who ? who + '的' : ''}技术大会，聚焦模型能力与落地实践。`,
    salon: `${where}${join}${who ? who + '的' : ''}深度分享，面向动手实践与经验交流。`,
    meetup: `${where}${join}${who ? who + '的' : ''}社区聚会，轻松交流与项目展示。`,
  };
  return map[t] || `${where}${join}${who ? who + '的' : ''}AI 活动。`;
}

module.exports = {
  CITY_LIST, CITY_NORMALIZE, CITY_ALIAS,
  detectCity, parseDate, detectVenue, detectAudience, isRealVenue,
  detectType, cleanTitle, refineTitle, isPastEvent, slug, iso,
  PAST_NOISE, OLD_YEAR_RE,
  extractHighlights, buildSummary,
};
