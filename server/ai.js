'use strict';
// AI 馆员智能体（Agent）· 数字人文平台版
// 架构：意图识别 → 槽位抽取 → 工具调用（本机 SQLite 真实数据）→ 答案合成 → 可选 LLM 润色
// 零 API 也能跑满能力；配置 LLM_API_URL + LLM_API_KEY 后自动升级为「工具增强大模型」
// 无用户系统：仅检索 / 荐书 / 问答，不做借阅
const db = require('./db');

const HISTORY_TURNS = 8;
const SESSION_TTL = 30 * 60 * 1000;
const sessions = new Map();          // 会话记忆（进程内，重启即清空）

// ==========================================================
// 一、文本理解
// ==========================================================
const STOP = new Set(['的', '了', '吗', '呢', '啊', '吧', '我', '你', '他', '它', '这', '那', '是', '在', '和', '与', '或',
  '请', '帮', '想', '要', '看', '读', '可以', '能', '不能', '几', '多少', '什么', '怎么', '如何', '哪', '里', '本', '书',
  '图书', '个', '一些', '给', '来', '找', '查', '问', '说', '需要', '关于', '有关', '相关', '推荐', '一下', '请问', '谢谢',
  '有没有', '没有', '有没有呢', '能否', '是否', '还有', '其它', '其他', '这些', '那些', '一下下', '两', '三',
  '的书', '哪些', '为什么', '是不是', '怎样', '怎么样', '的话', '麻烦', '我想要', '我想', '我要', '我要看']);

// 口语填充词：分词前先剥掉，避免「鲁迅有什么书」被切成「有什/什么/么书」捞到无关图书
const FILLER = /(怎么样|什么|怎么|怎样|哪些|为什么|是不是|如何|可以|能否|麻烦|请问|帮我|给我|我想看|我想读|我想借|我想要|我想|我要|有没有|有没有|的话|一下)/g;

const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };

function parseCount(q) {
  const m = q.match(/([0-9]+)\s*(本|册|部|个)/) || q.match(/([一二两三四五六七八九十]+)\s*(本|册|部|个)/);
  if (!m) return null;
  const n = CN_NUM[m[1]] !== undefined ? CN_NUM[m[1]] : parseInt(m[1], 10);
  return isFinite(n) ? Math.min(20, Math.max(1, n)) : null;
}

// 中文友好的分词：抽取《》书名 + 主词 + 二元组（提升召回）
function tokenize(q) {
  const s = String(q || '');
  const titles = [...s.matchAll(/[《<【]([^》>】]{1,40})[》>】]/g)].map(m => m[1].trim()).filter(Boolean);
  const rest = s.replace(/[《<【][^》>】]{1,40}[》>】]/g, ' ').replace(FILLER, ' ');
  const raw = rest.split(/[^\u4e00-\u9fa5A-Za-z0-9]+/).filter(Boolean);
  const tokens = raw.filter(t => t.length >= 1 && !STOP.has(t));
  const grams = [];
  tokens.forEach(t => {
    if (t.length > 2 && /^[\u4e00-\u9fa5]+$/.test(t)) for (let i = 0; i < t.length - 1; i++) grams.push(t.slice(i, i + 2));
  });
  return { titles, tokens, grams: [...new Set(grams)].slice(0, 8), text: s };
}

let _cats = null, _catsAt = 0, _authors = null, _authorsAt = 0;
function categories() {
  if (_cats && Date.now() - _catsAt < 60000) return _cats;
  _cats = db.prepare("SELECT DISTINCT category FROM books WHERE category IS NOT NULL AND category<>''").all().map(r => r.category);
  _catsAt = Date.now(); return _cats;
}
function authors() {
  if (_authors && Date.now() - _authorsAt < 60000) return _authors;
  _authors = db.prepare("SELECT DISTINCT author FROM books WHERE author IS NOT NULL AND author<>''").all().map(r => r.author);
  _authorsAt = Date.now(); return _authors;
}

const CAT_ALIAS = {
  '文学': '文学类', '小说': '文学类', '散文': '文学类', '诗歌': '文学类', '文学类': '文学类',
  '艺术': '艺术类', '设计': '艺术类', '美术': '艺术类', '音乐': '艺术类', '艺术类': '艺术类',
  '历史': '历史', '史学': '历史', '历史类': '历史',
  '思政': '思政综合类', '政治': '思政综合类', '党建': '思政综合类', '马哲': '思政综合类', '思政综合类': '思政综合类'
};

function extractSlots(q) {
  const text = String(q || '');
  let category = null;
  for (const c of categories()) if (text.includes(c)) { category = c; break; }
  if (!category) for (const [alias, real] of Object.entries(CAT_ALIAS)) {
    if (text.includes(alias) && categories().includes(real)) { category = real; break; }
  }
  let author = null;
  for (const a of authors()) { if (a && a.length >= 2 && text.includes(a)) { author = a; break; } }
  const year = (text.match(/(19|20)\d{2}/) || [])[0] || null;
  const limit = parseCount(text);
  const onlyAvailable = /可借|有货|在馆|能借|借得到|还有库存/.test(text);
  const { titles, tokens, grams } = tokenize(text);
  // 去掉意图噪声后的检索词
  const clean = String(text)
    .replace(/[《》]/g, ' ')
    .replace(/(怎么|如何|哪里|有没有|查找|搜索|搜一下|我想看|我想要|我想读|我想借|我要|推荐|建议|给我|帮我|请问|谢谢|有关|关于|相关|介绍一下|介绍一下|讲什么|内容简介|简介|怎么样|评价|口碑|类似|相似|同类|排行榜|热门|大家都在看)/g, ' ')
    .replace(/[?？。.，,！!、]/g, ' ').replace(/\s+/g, ' ').trim();
  return { category, author, year, limit, onlyAvailable, titles, tokens, grams, clean, text };
}

// 意图识别（关键词加权，命中即返回）
const INTENT_RULES = [
  ['greeting', /^(你好|您好|hi|hello|在吗|嗨|哈喽|早上好|晚上好|中午好)/i],
  ['thanks', /(谢谢|感谢|多谢|thx|thanks|辛苦了)/i],
  ['who', /(你是谁|你叫什么|什么模型|你能做什么|你会什么|能干什么|有什么功能|能力)/],
  ['stats', /(多少本|馆藏|总共有|统计|分类分布|占比|数据概况|规模|一共有)/],
  ['category', /(有哪些分类|分类有哪些|几个分类|什么分类|分类情况|分类列表|分类都有)/],
  ['hot', /(热门|最火|大家都在|排行榜|借阅最多|流行|最受欢迎|top)/i],
  ['similar', /(类似|相似|同类|差不多|同类型|差不多|像.*一样|相关的书)/],
  ['digest', /(讲什么|内容|简介|导读|概括|大意|摘要|说了什么|主要讲|介绍)/],
  ['availability', /(在馆|馆藏位置|在哪个|放哪|索书号|还有.*本|能不能借|能借吗|可以借吗|借吗|借得到|有货|库存|在哪)/],
  ['recommend', /(推荐|建议|看什么|适合|有什么好|给我找|想看|来几本|书单|读什么)/],
  ['rule', /(借期|多久|几天|续借|额度|上限|密码|开放时间|几本|怎么借|如何借|还书|归还|注册|账号|怎么登录|续借|预约)/],
  ['search', /(找|搜|查|有没有|我要|哪些|有没有.*书)/]
];
function detectIntent(q) {
  for (const [name, re] of INTENT_RULES) if (re.test(q)) return name;
  return 'search';
}
// 追问（依赖上一轮结果）
const FOLLOWUP = {
  more: /^(换一批|再来|再来几本|更多|其他|别的|还有吗|换几个|不够|继续)/,
  ordinal: /第\s*([0-9一二三四五六七八九十]+)\s*(本|个|部)/,
  pronoun: /(它|这本书|这本|这个|那本|那本书|上面那本|第一本)/
};

// ==========================================================
// 二、工具集（全部基于本机真实数据）
// ==========================================================
const F = 'id,title,author,category,tags,cover,call_no,location,publisher,year,price,intro,total,available';
function shape(b) {
  if (!b) return null;
  return {
    id: b.id, title: b.title, author: b.author || '', category: b.category || '',
    cover: b.cover || '', call_no: b.call_no || '', location: b.location || '',
    publisher: b.publisher || '', year: b.year || '', price: b.price || '',
    total: b.total, available: b.available, intro: (b.intro || '').slice(0, 90)
  };
}
const shapeAll = rows => rows.map(shape);

// 同一书目有多册/重复录入时只保留一条（优先可借的）
function dedupe(rows) {
  const seen = new Map();
  for (const b of rows) {
    const k = (b.title || '') + '|' + (b.author || '');
    const prev = seen.get(k);
    if (!prev) seen.set(k, b);
    else if (b.available > 0 && !(prev.available > 0)) seen.set(k, b);
  }
  return [...seen.values()];
}

// --- 检索：多字段加权打分 + 二元组召回兜底 ---
function searchBooks(q, opts = {}) {
  const limit = opts.limit || 8;
  const { titles, tokens, grams } = tokenize(String(q || ''));
  let terms = [...titles, ...tokens];
  if (!terms.length) return [];

  // core=true 时只匹配核心字段（用于二元组兜底，避免从简介里捞出无关书）
  const run = (ts, core) => {
    const cols = core ? ['title', 'author', 'tags', 'category'] : ['title', 'author', 'tags', 'category', 'intro', 'publisher'];
    const params = [];
    const cond = ts.map(() => '(' + cols.map(c => c + ' LIKE ?').join(' OR ') + ')');
    ts.forEach(t => { const l = `%${t}%`; cols.forEach(() => params.push(l)); });
    return db.prepare(`SELECT ${F} FROM books WHERE ${cond.join(' OR ')}`).all(...params);
  };
  const full = String(q).replace(/[《》\s]/g, '').toLowerCase();
  const score = (b, ts, core) => {
    const title = (b.title || '').toLowerCase();
    const author = (b.author || '').toLowerCase();
    const tags = (b.tags || '').toLowerCase();
    const cat = (b.category || '').toLowerCase();
    const intro = (b.intro || '').toLowerCase();
    const pub = (b.publisher || '').toLowerCase();
    const low = ts.map(t => String(t).toLowerCase());
    let s = 0;
    if (full && title === full) s += 30;
    if (full && title.startsWith(full)) s += 14;
    if (low.some(t => t && title.includes(t))) s += 10;
    if (low.some(t => t && author.includes(t))) s += 7;
    if (low.some(t => t && tags.includes(t))) s += 5;
    if (low.some(t => t && cat.includes(t))) s += 4;
    if (!core) {
      if (low.some(t => t && pub.includes(t))) s += 2;
      if (low.some(t => t && intro.includes(t))) s += 1.2;
    }
    if (b.available > 0) s += 1.5;
    return s;
  };
  const rank = (ts, core, minScore) => run(ts, core)
    .map(b => ({ b, s: score(b, ts, core) }))
    .filter(x => x.s >= minScore)
    .sort((a, b) => b.s - a.s);

  // 多词查询要求更高相关度，避免只凭一个泛词就返回结果
  const minScore = terms.length > 1 ? 5 : 1.2;
  let list = rank(terms, false, minScore);
  if (!list.length && grams.length) list = rank(grams, true, 4);   // 兜底：只认核心字段命中
  if (opts.category) list = list.filter(x => x.b.category === opts.category);
  if (opts.author) list = list.filter(x => (x.b.author || '').includes(opts.author));
  if (opts.year) list = list.filter(x => String(x.b.year) === String(opts.year));
  if (opts.onlyAvailable) list = list.filter(x => x.b.available > 0);
  return dedupe(list.map(x => x.b)).slice(0, limit);
}

// 按索书号 / 精确书名定位单本
function findBook(q) {
  const key = String(q || '').trim();
  if (!key) return null;
  const byCall = db.prepare(`SELECT ${F} FROM books WHERE call_no=? OR isbn=?`).get(key, key);
  if (byCall) return byCall;
  const exact = db.prepare(`SELECT ${F} FROM books WHERE title=?`).get(key);
  if (exact) return exact;
  const hit = searchBooks(key, { limit: 1 });
  return hit[0] || null;
}

function recommend(limit = 5, opts = {}) {
  const exclude = opts.exclude ? new Set(opts.exclude) : new Set();
  const pool = db.prepare(`SELECT ${F} FROM books`).all();
  const scored = pool.map(b => {
    let s = 0;
    if (b.available > 0) s += 1.5;
    s += Math.random() * 0.8;                    // 打散，保证「换一批」有变化
    return { b, s };
  }).filter(x => !exclude.has(x.b.id));
  scored.sort((a, b) => b.s - a.s);
  return dedupe(scored.map(x => x.b)).slice(0, limit);
}

function similarBooks(bookId, limit = 6) {
  const b = db.prepare(`SELECT ${F} FROM books WHERE id=?`).get(bookId);
  if (!b) return [];
  const tags = new Set((b.tags || '').split(',').map(t => t.trim()).filter(Boolean));
  const pool = db.prepare(`SELECT ${F} FROM books WHERE id<>?`).all(bookId);
  const scored = pool.map(x => {
    let s = 0;
    if (x.category === b.category) s += 4;
    if (b.author && x.author === b.author) s += 5;
    (x.tags || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => { if (tags.has(t)) s += 2.5; });
    if (x.available > 0) s += 1;
    return { x, s };
  }).filter(o => o.s > 0).sort((p, q) => q.s - p.s);
  return dedupe(scored.map(o => o.x)).slice(0, limit);
}

function booksByAuthor(author, limit = 8) {
  return dedupe(db.prepare(`SELECT ${F} FROM books WHERE author LIKE ?`).all(`%${author}%`)).slice(0, limit);
}
function booksByCategory(cat, limit = 8, onlyAvailable = false) {
  const rows = db.prepare(`SELECT ${F} FROM books WHERE category=?`).all(cat);
  const list = rows.filter(b => !onlyAvailable || b.available > 0)
    .map(b => ({ b, s: (b.available > 0 ? 1 : 0) + Math.random() }))
    .sort((a, b) => b.s - a.s);
  return dedupe(list.map(x => x.b)).slice(0, limit);
}
function hotBooks(limit = 8, cat = null) {
  // 无用户系统、无借阅流水：「热门」改为「新上架」——按入库时间倒序
  const rows = db.prepare(`SELECT ${F} FROM books ${cat ? 'WHERE category=?' : ''} ORDER BY id DESC LIMIT ?`)
    .all(...(cat ? [cat, limit] : [limit]));
  return dedupe(rows).slice(0, limit);
}
function libraryStats() {
  const t = db.prepare('SELECT COUNT(*) kinds, COALESCE(SUM(total),0) copies, COALESCE(SUM(available),0) avail FROM books').get();
  const cats = db.prepare("SELECT category, COUNT(*) c, COALESCE(SUM(total),0) t FROM books WHERE category IS NOT NULL AND category<>'' GROUP BY category ORDER BY c DESC").all();
  const works = db.prepare('SELECT COUNT(*) c FROM works WHERE visible=1').get().c;
  const posts = db.prepare('SELECT COUNT(*) c FROM posts WHERE visible=1').get().c;
  return { kinds: t.kinds, copies: t.copies, avail: t.avail, cats, works, posts };
}
// ==========================================================
// 三、规则知识库
// ==========================================================
const RULES = [
  { kw: ['摘星辰', '星辰计划', '星辰代号'], ans: '「摘星辰」是数文拾光协会的周期性可视化实践活动：每周一期，小组实操产出小型数字人文作品，每件作品带专属星辰代号（北极星/启明星/织女星/天狼星/牵牛星等）。成果都在「摘星辰」版块陈列。', chips: ['去摘星辰版块', '平台有哪些版块'] },
  { kw: ['版块', '平台', '数字人文平台', '能做什么'], ans: '本平台是数字人文综合展示平台，含四大版块：宇宙首页（3D 星系导航）、书库（学院真实馆藏）、摘星辰（社团可视化成果）、资讯（专业动态与学习资源）。', chips: ['推荐几本书', '摘星辰是什么'] },
  { kw: ['开放', '时间', '几点', '营业'], ans: '本平台 7×24 小时在线，可随时检索馆藏、浏览作品与资讯。' },
  { kw: ['qq', '群', '联系', '客服', '电话', '组委会'], ans: '社团相关事宜请联系数文拾光协会；本平台内容由创始人统一维护。' },
  { kw: ['数字人文', '什么是', '数文'], ans: '数字人文是用计算技术研究与呈现人文知识的交叉学科，涵盖文本挖掘、GIS、知识图谱、数字馆藏等。我可以直接帮你找相关馆藏。', chips: ['推荐数字人文的书', '有哪些分类？'] }
];
function matchRule(q) { for (const r of RULES) if (r.kw.some(k => q.includes(k))) return r; return null; }

// ==========================================================
// 四、会话记忆
// ==========================================================
function sessionKey() { return 'anon'; }
function getSession() {
  const k = sessionKey();
  let s = sessions.get(k);
  if (!s || Date.now() - s.ts > SESSION_TTL) {
    s = { turns: [], lastPool: [], poolOffset: 0, lastBooks: [], lastIntent: null, lastTool: null, ts: Date.now() };
    sessions.set(k, s);
  }
  s.ts = Date.now();
  return s;
}
function resetSession() { sessions.delete(sessionKey()); }
function remember(q, answer, extra = {}) {
  const s = getSession();
  s.turns.push({ q, a: (answer.reply || '').slice(0, 160), intent: answer.intent });
  if (s.turns.length > HISTORY_TURNS) s.turns.shift();
  if (extra.pool && extra.pool.length) { s.lastPool = extra.pool; s.poolOffset = extra.offset || 0; }
  if (answer.books && answer.books.length) s.lastBooks = answer.books.map(b => b.id);
  if (answer.intent) s.lastIntent = answer.intent;
  if (extra.tool) s.lastTool = extra.tool;
}

// ==========================================================
// 五、LLM 适配器（可选；工具增强）
// ==========================================================
function llmEnabled() { return !!(process.env.LLM_API_URL && process.env.LLM_API_KEY); }
function llmConfig() {
  return {
    url: process.env.LLM_API_URL,
    key: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL || 'gpt-3.5-turbo',
    temperature: Number(process.env.LLM_TEMPERATURE || 0.6),
    maxTokens: Number(process.env.LLM_MAX_TOKENS || 700),
    timeout: Number(process.env.LLM_TIMEOUT_MS || 20000)
  };
}
async function llmChat(messages, opts = {}) {
  const c = llmConfig();
  if (!c.url || !c.key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || c.timeout);
  try {
    const extra = process.env.LLM_HEADERS ? JSON.parse(process.env.LLM_HEADERS) : {};
    const resp = await fetch(c.url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}`, ...extra },
      body: JSON.stringify({
        model: c.model, messages,
        temperature: opts.temperature ?? c.temperature,
        max_tokens: opts.maxTokens ?? c.maxTokens,
        stream: false
      })
    });
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (e) { return null; } finally { clearTimeout(timer); }
}

// 供 LLM 使用的工具声明
const TOOL_SPECS = [
  { name: 'search', desc: '按关键词检索馆藏图书', args: { keywords: '关键词，空格分隔' } },
  { name: 'recommend', desc: '推荐馆藏图书', args: {} },
  { name: 'similar', desc: '找与某本书相似的图书', args: { book: '书名' } },
  { name: 'byCategory', desc: '列出某个分类的图书', args: { category: '分类名' } },
  { name: 'hot', desc: '新上架精选', args: {} },
  { name: 'stats', desc: '馆藏与平台内容统计', args: {} },
  { name: 'availability', desc: '查某本书的馆藏位置与册数', args: { book: '书名' } }
];
function runToolByName(name, args, ctx) {
  switch (name) {
    case 'search': return { books: shapeAll(searchBooks(args.keywords || '', { limit: 8 })) };
    case 'recommend': return { books: shapeAll(recommend(5)) };
    case 'similar': { const b = findBook(args.book || ''); return b ? { books: shapeAll(similarBooks(b.id, 6)), anchor: shape(b) } : {}; }
    case 'byCategory': return { books: shapeAll(booksByCategory(args.category || '', 8)) };
    case 'hot': return { books: shapeAll(hotBooks(8)) };
    case 'stats': return { stats: libraryStats() };
    case 'availability': { const b = findBook(args.book || ''); return b ? { books: [shape(b)] } : {}; }
    default: return {};
  }
}
function toolResultToText(r) {
  const parts = [];
  if (r.books && r.books.length) parts.push('图书：' + r.books.map(b => `《${b.title}》${b.author ? '（' + b.author + '）' : ''}[${b.category || '未分类'}]${b.location ? '位置' + b.location : ''}`).join('；'));
  if (r.error) parts.push('⚠️ ' + r.error);
  if (r.anchor) parts.push('目标书：' + `《${r.anchor.title}》${r.anchor.author || ''}｜${r.anchor.category || ''}｜共 ${r.anchor.total} 册${r.anchor.location ? '｜位置' + r.anchor.location : ''}`);
  if (r.stats) {
    const s = r.stats;
    parts.push(`馆藏：${s.kinds} 种 / ${s.copies} 册；摘星辰作品 ${s.works} 件，资讯 ${s.posts} 条。分类：` +
      s.cats.map(c => `${c.category} ${c.c} 种`).join('、'));
  }
  return parts.join('\n') || '（无结果）';
}

// ==========================================================
// 六、答案合成（离线大脑）
// ==========================================================
const CHIPS_DEFAULT = ['推荐几本书', '馆藏有多少本书？', '新上架', '摘星辰是什么'];

function fmtBooks(books) {
  return books.map((b, i) => `${i + 1}. 《${b.title}》${b.author ? ' · ' + b.author : ''}${b.category ? ' · ' + b.category : ''}${b.available > 0 ? '' : ' · 已借完'}`).join('\n');
}

function toolSearch(slots, q) {
  const terms = [...slots.titles, ...(slots.clean ? [slots.clean] : [])].filter(Boolean);
  const kw = terms.join(' ') || slots.text;
  const books = searchBooks(kw, {
    limit: slots.limit || 8, category: slots.category, author: slots.author,
    year: slots.year, onlyAvailable: slots.onlyAvailable
  });
  // 池：用于「换一批」
  const pool = searchBooks(kw, { limit: 40, category: slots.category, author: slots.author, onlyAvailable: slots.onlyAvailable }).map(b => b.id);
  if (!books.length) return null;
  const scope = [slots.category, slots.author, slots.year].filter(Boolean).join(' / ');
  return {
    reply: `为你找到 ${books.length} 本${scope ? '（' + scope + '）' : ''}相关馆藏：\n${fmtBooks(books)}\n回复「第 N 本」可以看详情，或点卡片直达。`,
    books: shapeAll(books), pool, offset: books.length,
    chips: ['换一批', '介绍一下第 1 本', '馆藏统计'],
    intent: 'search'
  };
}
function toolRecommend(slots, exclude) {
  const n = slots.limit || 5;
  const books = slots.category ? booksByCategory(slots.category, n) : recommend(n, { exclude });
  if (!books.length) return null;
  return {
    reply: `为你推荐 ${books.length} 本馆藏：\n${fmtBooks(books)}`,
    books: shapeAll(books), pool: books.map(b => b.id), offset: books.length,
    chips: ['换一批', '还有类似的吗？', '馆藏统计'], intent: 'recommend'
  };
}
function toolSimilar(slots, forceBook) {
  const b = forceBook || findBook(slots.titles[0] || slots.clean);
  if (!b) return null;
  const sim = similarBooks(b.id, 6);
  if (!sim.length) return { reply: `暂未找到与《${b.title}》相近的馆藏。`, books: [shape(b)], intent: 'similar', chips: ['推荐几本书'] };
  return {
    reply: `与《${b.title}》（${b.category || '未分类'}）相近的馆藏：\n${fmtBooks(sim)}`,
    books: shapeAll(sim), pool: sim.map(x => x.id), offset: sim.length,
    chips: ['换一批', `介绍一下《${b.title}》`, '新上架'], intent: 'similar'
  };
}
function toolHot(slots) {
  const books = hotBooks(slots.limit || 8, slots.category);
  if (!books.length) return null;
  return {
    reply: '最近新上架的馆藏：\n' + fmtBooks(shapeAll(books)),
    books: shapeAll(books), pool: books.map(b => b.id), offset: books.length,
    chips: ['推荐几本书', '馆藏统计'], intent: 'hot'
  };
}
function toolStats() {
  const s = libraryStats();
  const cats = s.cats.map(c => `· ${c.category}：${c.c} 种 / ${c.t} 册`).join('\n');
  return {
    reply: `数字人文平台内容概况：\n· 馆藏图书 ${s.kinds} 种，共 ${s.copies} 册\n· 摘星辰作品 ${s.works} 件 · 资讯 ${s.posts} 条\n分类分布：\n${cats}`,
    books: [], chips: ['推荐几本书', '新上架', '有哪些分类？'], intent: 'stats'
  };
}
function toolAvailability(slots, forceBook) {
  const b = forceBook || findBook(slots.titles[0] || slots.clean);
  if (!b) return null;
  return {
    reply: `《${b.title}》${b.author ? '（' + b.author + '）' : ''}\n· 索书号：${b.call_no || '—'}\n· 馆藏位置：${b.location || '—'}\n· 馆藏共 ${b.total} 册\n可到「书库」查看详情与 AI 导读。`,
    books: [shape(b)], intent: 'availability', chips: ['还有类似的吗？', '推荐几本书']
  };
}
function toolDigest(slots, forceBook) {
  const b = forceBook || findBook(slots.titles[0] || slots.clean);
  if (!b) return null;
  const rel = similarBooks(b.id, 4);
  const intro = (b.intro || '').trim() || '馆藏暂未录入官方简介，可从目录与章节入手。';
  const tags = (b.tags || '').split(',').filter(Boolean);
  return {
    reply: `《${b.title}》${b.author ? ' · ' + b.author : ''}（${b.category || '未分类'}${b.publisher ? ' · ' + b.publisher : ''}${b.year ? ' · ' + b.year : ''}）\n${intro}${tags.length ? '\n关键词：' + tags.join('、') : ''}\n馆藏共 ${b.total} 册${b.location ? '，位置 ' + b.location : ''}。`,
    books: shapeAll(rel), intent: 'digest', chips: ['还有类似的吗？', '推荐几本书']
  };
}
function toolCategory(slots) {
  const cats = categories();
  if (slots.category) {
    const books = booksByCategory(slots.category, slots.limit || 8, slots.onlyAvailable);
    if (books.length) return {
      reply: `「${slots.category}」下有 ${books.length} 本推荐先读：\n${fmtBooks(books)}`,
      books: shapeAll(books), pool: books.map(b => b.id), offset: books.length,
      intent: 'category', chips: ['换一批', '这个分类有多少本？']
    };
  }
  const st = libraryStats();
  return {
    reply: `馆藏共 ${cats.length} 个分类：\n${st.cats.map(c => '· ' + c.category + '：' + c.c + ' 种').join('\n')}\n直接说分类名（如「历史」）我就能列出该分类的书。`,
    books: [], intent: 'category', chips: cats.slice(0, 3).map(c => c + '有什么书？')
  };
}

const PERSONA = '你是「数智馆员小文」，贵州师范大学数字人文学院图书室的 AI 馆员。';

// 兜底：明确告诉用户没找到，并给出可用入口
function fallbackAnswer(slots) {
  const want = (slots && slots.titles && slots.titles[0]) || '';
  if (want) {
    const near = searchBooks(want, { limit: 3 });
    if (near.length) return {
      reply: `馆藏里没有《${want}》这本。相近的有：
${fmtBooks(shapeAll(near))}`,
      books: shapeAll(near), intent: 'fallback', chips: ['推荐几本书', '馆藏统计']
    };
    return {
      reply: `馆藏里暂时没有《${want}》。换个书名或作者再试试？也可以让我按分类推荐。`,
      books: shapeAll(recommend(3)), intent: 'fallback', chips: ['推荐几本书', '有哪些分类？']
    };
  }
  return {
    reply: '没找到完全匹配的馆藏。你可以这样问我：\n· 「推荐几本历史的书」\n· 「《XXX》的简介和馆藏位置」\n· 「馆藏有多少本书」\n· 「摘星辰是什么」',
    books: shapeAll(recommend(3)), intent: 'fallback', chips: CHIPS_DEFAULT
  };
}

function smalltalk(kind) {
  if (kind === 'greeting') return { reply: '你好呀～ 我是小文，数字人文平台的 AI 馆员。找书、荐书、问平台版块，都可以直接问我。', books: [], intent: 'greeting', chips: ['推荐几本书', '馆藏有多少本书？', '摘星辰是什么'] };
  if (kind === 'thanks') return { reply: '不客气～ 还要找别的书随时叫我。', books: [], intent: 'thanks', chips: ['推荐几本书'] };
  return {
    reply: '我是数智馆员小文，能做的事：\n· 检索馆藏（书名 / 作者 / 标签 / 索书号）\n· 荐书与相似书推荐\n· 查馆藏位置、册数\n· 馆藏统计与新上架\n· 介绍平台版块与摘星辰计划\n· 为单本书生成 AI 导读',
    books: [], intent: 'who', chips: ['推荐几本书', '馆藏统计', '摘星辰是什么']
  };
}

// 离线大脑主流程
function offlineAnswer(q, slots, intent, sess) {
  // 追问：换一批
  if (FOLLOWUP.more.test(q) && sess.lastPool && sess.lastPool.length) {
    const start = Math.min(sess.poolOffset || 0, sess.lastPool.length - 1);
    const ids = sess.lastPool.slice(start, start + 5);
    if (ids.length) {
      const books = ids.map(id => db.prepare(`SELECT ${F} FROM books WHERE id=?`).get(id)).filter(Boolean);
      return { reply: '换一批看看：\n' + fmtBooks(shapeAll(books)), books: shapeAll(books), pool: sess.lastPool, offset: start + books.length, intent: 'more', chips: ['换一批', '推荐几本书'] };
    }
    return { reply: '这一批已经翻完啦，换个关键词试试？', books: [], intent: 'more', chips: ['推荐几本书'] };
  }
  // 追问：第 N 本 / 指代上一本 → 给详情
  const ord = q.match(FOLLOWUP.ordinal);
  const hasExplicitTitle = (slots.titles || []).length > 0;
  const useLast = !hasExplicitTitle && FOLLOWUP.pronoun.test(q) && sess.lastBooks && sess.lastBooks.length;
  if (ord || useLast) {
    let id = null;
    if (ord) {
      const n = CN_NUM[ord[1]] !== undefined ? CN_NUM[ord[1]] : parseInt(ord[1], 10);
      id = (sess.lastBooks || [])[n - 1] || (sess.lastPool || [])[n - 1] || null;
    } else id = sess.lastBooks[sess.lastBooks.length - 1];
    if (id) {
      const b = db.prepare(`SELECT ${F} FROM books WHERE id=?`).get(id);
      if (b) return toolDigest({ titles: [b.title], clean: b.title }, b);
    }
  }

  // 指定了书名却查不到 → 直接给出「没有这本」的兜底，不再瞎猜
  const anchor = slots.titles.length ? findBook(slots.titles[0]) : null;
  if (['similar', 'digest', 'availability'].includes(intent) && slots.titles.length && !anchor) return fallbackAnswer(slots);

  switch (intent) {
    case 'greeting': case 'thanks': case 'who': return smalltalk(intent);
    case 'stats': return toolStats();
    case 'hot': return toolHot(slots) || toolStats();
    case 'similar': return toolSimilar(slots, anchor) || toolSearch(slots, q) || fallbackAnswer(slots);
    case 'digest': return toolDigest(slots, anchor) || toolSearch(slots, q) || fallbackAnswer(slots);
    case 'availability': return toolAvailability(slots, anchor) || toolSearch(slots, q) || fallbackAnswer(slots);
    case 'recommend': return toolRecommend(slots, sess.lastBooks) || toolSearch(slots, q) || fallbackAnswer(slots);
    case 'category': return toolCategory(slots);
    case 'rule': {
      const r = matchRule(q);
      if (r) return { reply: r.ans, books: [], intent: 'rule', chips: r.chips || CHIPS_DEFAULT.slice(0, 2) };
      break;
    }
    default: break;
  }
  const s2 = toolSearch(slots, q);
  if (s2) return s2;
  const r = matchRule(q);
  if (r) return { reply: r.ans, books: [], intent: 'rule', chips: r.chips || CHIPS_DEFAULT.slice(0, 2) };
  return fallbackAnswer(slots);
}

// ==========================================================
// 七、主入口：离线优先 + LLM 工具增强
// ==========================================================
async function answer(question) {
  const q = String(question || '').trim();
  if (!q) return { reply: '请告诉我你想查什么书，或问我平台的版块～', books: [], chips: CHIPS_DEFAULT };
  const sess = getSession();
  const slots = extractSlots(q);
  const intent = detectIntent(q);
  const offline = offlineAnswer(q, slots, intent, sess) || fallbackAnswer(slots);
  offline.mode = 'rule';

  if (!llmEnabled()) { remember(q, offline, { pool: offline.pool, offset: offline.offset }); return offline; }

  // ---- LLM 工具增强：先让模型选工具，再用真实数据作答 ----
  try {
    const hist = sess.turns.slice(-4).map(t => `${t.q} → ${t.a}`).join('\n');
    const catalog = TOOL_SPECS.map(t => `- ${t.name}(${Object.keys(t.args).join(',') || ''})：${t.desc}`).join('\n');
    const plan = await llmChat([
      { role: 'system', content: PERSONA + '你是工具调度器。根据用户问题从工具清单中选一个，只输出 JSON：{"tool":"工具名","args":{...}}，无法判断时用 {"tool":"none","args":{}}。不要输出其它文字。\n工具清单：\n' + catalog },
      { role: 'user', content: (hist ? '历史对话：\n' + hist + '\n' : '') + '用户问题：' + q }
    ], { temperature: 0, maxTokens: 200 });
    let picked = null;
    if (plan) {
      const m = plan.match(/\{[\s\S]*\}/);
      if (m) { try { picked = JSON.parse(m[0]); } catch (e) { picked = null; } }
    }
    if (picked && picked.tool && picked.tool !== 'none') {
      const res = runToolByName(picked.tool, picked.args || {}, {});
      const ctxText = toolResultToText(res);
      const final = await llmChat([
        { role: 'system', content: PERSONA + '严格基于工具返回的真实数据作答，中文，简洁（120 字以内），书名用《》。不要编造数据。' },
        { role: 'user', content: `用户问题：${q}\n工具返回：
${ctxText}` }
      ]);
      if (final) {
        const out = {
          reply: final, books: res.books || [], intent: picked.tool, mode: 'llm',
          chips: ['换一批', '还有类似的吗？', '馆藏统计'],
          pool: (res.books || []).map(b => b.id), offset: (res.books || []).length
        };
        remember(q, out, { pool: out.pool, offset: out.offset });
        return out;
      }
      if ((res.books || []).length) offline.books = res.books;
    }
    // 直答（不带工具）
    const direct = await llmChat([
      { role: 'system', content: PERSONA + '中文作答，简洁专业，120 字以内。' },
      { role: 'user', content: q }
    ]);
    if (direct) {
      const out = { reply: direct, books: offline.books || [], intent, mode: 'llm', chips: offline.chips || CHIPS_DEFAULT, pool: offline.pool, offset: offline.offset };
      remember(q, out, { pool: out.pool, offset: out.offset });
      return out;
    }
  } catch (e) { /* 任何异常都回落到离线结果 */ }

  remember(q, offline, { pool: offline.pool, offset: offline.offset });
  return offline;
}

// ==========================================================
// 八、AI 导读（RAG + 真实数据）
// ==========================================================
async function digest(book) {
  const related = similarBooks(book.id, 4);
  const tags = (book.tags || '').split(',').filter(Boolean);
  const ctx = [
    `书名：${book.title}`, `分类：${book.category || '未分类'}`, `作者：${book.author || '未知'}`,
    `出版社：${book.publisher || '未知'}`, `年份：${book.year || '未知'}`,
    `索书号：${book.call_no || '—'}`, `馆藏位置：${book.location || '—'}`,
    `馆藏：共 ${book.total} 册`,
    `简介：${book.intro || '无'}`, `标签：${tags.join('、') || '无'}`,
    `同分类相关：${related.map(b => '《' + b.title + '》').join('、') || '无'}`
  ].join('\n');
  if (llmEnabled()) {
    const t = await llmChat([
      { role: 'system', content: PERSONA + '请为这本书写一段面向读者的导读：3-5 句，点明主题、价值与阅读建议，书名用《》。只基于给定资料，不要编造。' },
      { role: 'user', content: ctx }
    ]);
    if (t) return { reply: t, books: shapeAll(related), mode: 'llm' };
  }
  const intro = (book.intro || '').trim() || '馆藏暂未录入官方简介，建议先读目录与第一章把握框架。';
  const tagTxt = tags.length ? '阅读时可重点关注：' + tags.join('、') + '。' : '';
  return {
    reply: `《${book.title}》属于「${book.category || '未分类'}」${book.author ? ('，作者' + book.author) : ''}${book.publisher ? ('，' + book.publisher) : ''}${book.year ? ('，' + book.year) : ''}。
${intro}
${tagTxt}馆藏共 ${book.total} 册${book.location ? ('，位置 ' + book.location) : ''}。`,
    books: shapeAll(related), mode: 'rule'
  };
}

function status() {
  const online = llmEnabled();
  return {
    online, mode: online ? 'llm' : 'rule',
    model: online ? (process.env.LLM_MODEL || 'gpt-3.5-turbo') : 'offline-agent',
    tools: TOOL_SPECS.map(t => t.name),
    intents: INTENT_RULES.map(r => r[0]),
    memory: true
  };
}

module.exports = {
  answer, digest, status, resetSession,
  searchBooks, recommend, similarBooks, hotBooks, libraryStats, findBook
};
