'use strict';
// AI 助手 v1：检索增强 + 规则问答 + 相似度推荐（零 API、零费用、离线可跑）
// 预留 LLM 适配器：配置 LLM_API_URL + LLM_API_KEY 后自动升级为真实大模型
const db = require('./db');

const BORROW_DAYS = 30; // 默认借期（天）

// ---------- 检索（分词匹配 + 相关度排序） ----------
function searchBooks(q, limit = 8) {
  const kw = String(q || '').trim();
  if (!kw) return [];
  const tokens = kw.split(/[\s,，、]+/).map(t => t.trim()).filter(Boolean);
  if (!tokens.length) return [];
  const params = [];
  const conds = tokens.map(() => '(title LIKE ? OR author LIKE ? OR tags LIKE ? OR category LIKE ? OR intro LIKE ?)');
  tokens.forEach(t => { const l = `%${t}%`; params.push(l, l, l, l, l); });
  const rows = db.prepare(`SELECT * FROM books WHERE ${conds.join(' OR ')}`).all(...params);
  const score = (b) => tokens.reduce((s, t) => {
    const hay = (b.title + ' ' + b.author + ' ' + b.tags + ' ' + b.category).toLowerCase();
    return s + (hay.includes(t.toLowerCase()) ? 1 : 0);
  }, 0);
  return rows.map(b => ({ b, s: score(b) })).sort((x, y) => y.s - x.s).slice(0, limit).map(x => x.b);
}

// 热门度（被借次数）
function borrowCounts() {
  const rows = db.prepare('SELECT book_id, COUNT(*) c FROM borrows GROUP BY book_id').all();
  const m = {};
  for (const r of rows) m[r.book_id] = r.c;
  return m;
}

// ---------- 推荐 ----------
function recommend(uid, limit = 5) {
  let profileTags = new Set();
  let profileCats = new Set();
  let borrowedIds = new Set();
  if (uid) {
    const hist = db.prepare('SELECT b.* FROM borrows r JOIN books b ON b.id=r.book_id WHERE r.user_id=?').all(uid);
    for (const b of hist) {
      borrowedIds.add(b.id);
      (b.tags || '').split(',').forEach(t => t.trim() && profileTags.add(t.trim()));
      if (b.category) profileCats.add(b.category);
    }
  }
  const books = db.prepare('SELECT * FROM books').all();
  const counts = borrowCounts();
  const scored = books.map(b => {
    let score = 0;
    const tags = (b.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    for (const t of tags) if (profileTags.has(t)) score += 3;
    if (profileCats.has(b.category)) score += 2;
    score += (counts[b.id] || 0) * 0.5;          // 热门度
    if (b.available > 0) score += 1;             // 可借优先
    return { b, score };
  }).filter(x => !borrowedIds.has(x.b.id));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(x => x.b);
}

// ---------- 规则知识库 ----------
const RULES = [
  { kw: ['借期', '多久', '几天', '多长时间'], ans: `每本书默认借阅期为 ${BORROW_DAYS} 天，到期前可在「我的借阅」中查看剩余时间，请及时归还或联系馆员。` },
  { kw: ['逾期', '超期', '罚款', '罚'], ans: '逾期未还会影响后续借阅权限；系统会在「我的借阅」中标记逾期状态并提示。请尽快归还，具体滞纳金规则以图书室公示为准。' },
  { kw: ['续借', '延长'], ans: '如需延长借阅，请在到期前联系馆员或通过图书室服务台办理续借。' },
  { kw: ['几本', '多少本', '额度', '上限', '能借'], ans: '读者默认最多同时借阅 5 本（max_borrow）。可在「我的借阅」查看当前已借数量与剩余额度。' },
  { kw: ['注册', '账号', '开户', '怎么登录'], ans: '点击首页「注册」用学号/邮箱创建读者账号即可借阅；馆员与管理员账号由系统统一开通。' },
  { kw: ['开放', '时间', '几点', '营业'], ans: '图书室开放时间请以学院公告为准；系统全天候支持线上检索、预约与借阅记录查询。' },
  { kw: ['怎么借', '如何借', '借书'], ans: '在馆藏中搜到心仪的书 → 进入详情页 → 点击「借阅」即可；借满额度或库存为 0 时无法借阅。' },
  { kw: ['还书', '归还', '怎么还'], ans: '到图书室服务台归还，或由馆员在后台操作「归还」。归还后借阅记录会更新为「已还」。' },
  { kw: ['密码', '忘记'], ans: '读者密码请妥善保管；若遗忘，请联系图书室馆员重置。' },
  { kw: ['qq', '群', '联系', '客服', '电话'], ans: '大赛官方 QQ 群：705263206；赛事咨询可联系组委会（详见大赛通知）。' },
  { kw: ['数字人文', '什么是'], ans: '数字人文是用计算技术研究与呈现人文知识的交叉领域，涉及文本挖掘、GIS、知识图谱、数字馆藏等。我可以为你推荐相关书目。' }
];

function matchRule(q) {
  for (const r of RULES) if (r.kw.some(k => q.includes(k))) return r.ans;
  return null;
}

// ---------- LLM 适配器（可选） ----------
async function callLLM(question, context) {
  const url = process.env.LLM_API_URL;
  const key = process.env.LLM_API_KEY;
  if (!url || !key) return null; // 未配置 → 走规则引擎
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: '你是数字人文学院图书室的 AI 助理，回答要简洁、基于馆藏。' },
          { role: 'user', content: `${context}\n用户问题：${question}` }
        ]
      })
    });
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (e) { return null; }
}

// ---------- AI 导读（RAG + 离线模板） ----------
async function digest(book, { uid } = {}) {
  const related = db.prepare('SELECT * FROM books WHERE category=? AND id<>? LIMIT 4').all(book.category, book.id);
  const tags = (book.tags || '').split(',').filter(Boolean);
  const ctx = [
    `书名：${book.title}`, `分类：${book.category}`, `作者：${book.author || '未知'}`,
    `简介：${book.intro || '无'}`, `标签：${tags.join('、') || '无'}`,
    `同分类相关：${related.map(b => '《' + b.title + '》').join('、') || '无'}`
  ].join('\n');
  if (process.env.LLM_API_URL && process.env.LLM_API_KEY) {
    const t = await callLLM('请为这本书写一段面向读者的导读（3-5 句，点明主题、价值与阅读建议）：' + book.title, ctx);
    if (t) return { reply: t, books: related };
  }
  const intro = book.intro && book.intro.trim() ? book.intro.trim() : '暂无官方简介，可先从目录与书评入手。';
  const tagTxt = tags.length ? '阅读时可重点关注：' + tags.join('、') + '。' : '';
  const reply = `《${book.title}》属于「${book.category}」类${book.author ? ('，作者' + book.author) : ''}。\n${intro}\n${tagTxt}适合作为数字人文交叉学习的参考资料。`;
  return { reply, books: related };
}

// ---------- 主入口 ----------
async function answer(question, { uid } = {}) {
  const q = String(question || '').trim();
  if (!q) return { reply: '请告诉我你想查什么书，或问我借阅规则～', books: [] };

  // 1) 推荐意图
  if (/推荐|建议|看什么|适合|有什么好|给我找|想看/.test(q)) {
    const books = recommend(uid);
    if (books.length) {
      return {
        reply: `根据你的兴趣，为你推荐以下 ${books.length} 本（可进入详情页一键借阅）：`,
        books
      };
    }
    return { reply: '暂时没有可推荐的书目，换个方向试试？', books: [] };
  }

  // 2) 检索意图
  const clean = q.replace(/[?？。.，,！!]/g, ' ')
    .replace(/(怎么|如何|哪里|什么|哪些|有没有|查找|搜|找|关于|我想看|我要|有|一本|介绍)/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const found = searchBooks(clean, 8);
  if (found.length) {
    const names = found.slice(0, 5).map(b => `《${b.title}》`).join('、');
    return { reply: `为你找到 ${found.length} 本相关图书，例如：${names}。`, books: found };
  }

  // 3) 规则问答
  const rule = matchRule(q);
  if (rule) return { reply: rule, books: [] };

  // 4) LLM（若配置，带 RAG 检索上下文）
  const ctx = searchBooks(clean, 5).map(b => `《${b.title}》(${b.category}${b.author ? ('，' + b.author) : ''})`).join('；');
  const llm = await callLLM(q, ctx ? ('馆藏相关图书：' + ctx) : '');
  if (llm) return { reply: llm, books: [] };

  // 5) 兜底
  const hot = recommend(uid, 3);
  return {
    reply: '我暂时没匹配到确切答案。你可以这样问我：\n• 「推荐几本数字人文的书」\n• 「有没有 Python 入门」\n• 「借期是多久？」',
    books: hot
  };
}

module.exports = { answer, searchBooks, recommend, digest, BORROW_DAYS };
