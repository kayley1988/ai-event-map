/**
 * 数据源配置
 * 每个源说明如何抓取 + 如何从原始内容中抽取活动信息
 *
 * type:
 *   - 'search'  : 搜索引擎结果页，抽取标题/链接/摘要
 *   - 'rss'     : RSS/Atom 订阅源
 *   - 'wechat'  : 搜狗微信搜索（公众号文章）
 */

const SOURCES = [
  /* ============ 专门的活动聚合站（高价值） ============ */
  {
    id: 'aicompetition',
    name: 'AI Competition Radar',
    type: 'search',
    url: 'https://www.aicompetition.dev/zh',
    queries: [''],
    weight: 6,
  },

  /* ============ 搜索引擎：覆盖小红书/抖音/公众号在网页端的索引 ============ */
  {
    id: 'bing-hackathon',
    name: '必应搜索 · AI 黑客松',
    type: 'search',
    url: 'https://cn.bing.com/search?q={q}&ensearch=0',
    queries: [
      'AI 黑客松 报名 2026',
      'AI Hackathon 中国 2026 报名',
      '大模型 黑客松 2026 招募',
      'AI Agent 开发者大会 2026',
      '大模型 开发者大会 2026 报名',
    ],
    weight: 3,
  },
  {
    id: 'bing-xhs',
    name: '必应搜索 · 小红书 AI 活动',
    type: 'search',
    url: 'https://cn.bing.com/search?q={q}&ensearch=0',
    queries: [
      'site:xiaohongshu.com AI 黑客松 活动',
      'site:xiaohongshu.com AI 大赛 报名',
    ],
    weight: 3,
  },
  {
    id: 'bing-douyin',
    name: '必应搜索 · 抖音 AI 活动',
    type: 'search',
    url: 'https://cn.bing.com/search?q={q}&ensearch=0',
    queries: [
      'site:douyin.com AI 黑客松',
      'site:douyin.com AI 大赛 报名',
    ],
    weight: 3,
  },
  {
    id: 'bing-conference',
    name: '必应搜索 · AI 峰会/大会',
    type: 'search',
    url: 'https://cn.bing.com/search?q={q}&ensearch=0',
    queries: [
      'AI 峰会 大会 2026 报名 中国',
      '人工智能 大会 论坛 2026 议程',
      'AI 沙龙 线下 活动 2026',
      '大模型 发布会 2026',
    ],
    weight: 2,
  },

  /* ============ 微信公众号：搜狗微信搜索 ============ */
  {
    id: 'sogou-wechat',
    name: '搜狗微信 · 公众号',
    type: 'wechat',
    url: 'https://weixin.sogou.com/weixin?type=2&query={q}&ie=utf8',
    queries: [
      'AI黑客松',
      'AI 黑客松 报名',
      '大模型 黑客松',
      'AI 大会 报名',
      'AI 开发者 活动',
      'AI 沙龙 活动',
      '大模型 开发者大会',
    ],
    weight: 4,
  },
  {
    // 按公众号名定向检索，补足 AI 资讯频道里的公众号内容
    // （原来是关键词式搜索，命中的多是活动报名帖，缺少行业媒体文章）
    id: 'sogou-mp-media',
    name: '公众号 · AI 媒体',
    type: 'wechat',
    url: 'https://weixin.sogou.com/weixin?type=2&query={q}&ie=utf8',
    queries: [
      '机器之心 Agent',
      '量子位 大模型',
      '新智元 AI',
      '智东西 大模型',
      'AI科技评论 智能体',
      'InfoQ 大模型',
      '甲子光年 AI',
      '硅星人 AI',
      'Founder Park 黑客松',
      'AI产品榜 智能体',
      '特工宇宙 Agent',
      '腾讯科技 大模型',
    ],
    weight: 3,
  },

  /* ============ RSS 源：AI 媒体的活动报道 ============ */
  {
    id: 'rss-infoq',
    name: 'InfoQ 中国',
    type: 'rss',
    url: 'https://www.infoq.cn/feed',
    queries: ['黑客松', '大会', '沙龙', '开发者'],
    weight: 2,
  },
  {
    id: 'rss-woshipm',
    name: '人人都是产品经理',
    type: 'rss',
    url: 'https://www.woshipm.com/feed',
    queries: ['黑客松', '大会', '活动', '沙龙'],
    weight: 2,
  },
  {
    id: 'rss-sspai',
    name: '少数派',
    type: 'rss',
    url: 'https://sspai.com/feed',
    queries: ['黑客松', '大会', '活动'],
    weight: 1,
  },
  {
    id: 'rss-qbitai',
    name: '量子位',
    type: 'rss',
    url: 'https://www.qbitai.com/feed',
    queries: ['大模型', 'Agent', 'AI', '活动'],
    weight: 3,
  },
  {
    id: 'rss-ifanr',
    name: '爱范儿',
    type: 'rss',
    url: 'https://www.ifanr.com/feed',
    queries: ['AI', '大模型', '智能'],
    weight: 2,
  },
  {
    id: 'rss-leiphone',
    name: '雷峰网',
    type: 'rss',
    url: 'https://www.leiphone.com/feed',
    queries: ['AI', '大模型', '智能体'],
    weight: 2,
  },
  {
    id: 'rss-geekpark',
    name: '极客公园',
    type: 'rss',
    url: 'https://www.geekpark.net/rss',
    queries: ['AI', '大模型', 'Agent'],
    weight: 2,
  },
  {
    id: 'rss-synced',
    name: '机器之心 · Synced',
    type: 'rss',
    url: 'https://syncedreview.com/feed/',
    queries: ['hackathon', 'conference', 'summit', 'meetup'],
    weight: 2,
  },
];

/** 关键词过滤：只有命中活动类关键词的条目才会入库 */
const EVENT_KEYWORDS = [
  '黑客松', 'hackathon', 'hack week', 'hackathon', '开发者大会', '开发者日',
  '技术大会', '峰会', '论坛', '沙龙', 'meetup', '线下活动', '开放日',
  '训练营', 'bootcamp', 'workshop', '路演', 'demo day', '创投大会',
  'ai 大会', 'ai 峰会', 'ai 沙龙', '大模型 大会', 'llm', 'agent 大会',
  '报名通道', '报名从速', '招募令', '火热报名', '开放报名', '限时报名',
];

/** 明显不是活动的噪音词 */
const NOISE_KEYWORDS = [
  '招聘', '简历', '股票', '股价', '融资新闻', '财报', '教程', '入门指南',
  '源码', '开源项目', '论文解读', '综述', '盘点', '周报', '日报',
];

module.exports = { SOURCES, EVENT_KEYWORDS, NOISE_KEYWORDS };
