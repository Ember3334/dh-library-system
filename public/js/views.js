'use strict';
// 视图渲染层（原生 JS）
const Views = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const app = () => $('#app');

  // ---------- 知识星空 Canvas 渲染器 ----------
  class StarScene {
    constructor(canvas, books) {
      this.canvas = canvas;
      this.books = books;
      this.stars = [];
      this.hoverId = null;
      this.raf = null;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.encounterId = null;
      this.resize();
      this.build();
      this.bind();
      this.loop();
      this._ro = new ResizeObserver(() => { this.resize(); this.build(); });
      this._ro.observe(canvas.parentElement);
    }
    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.w = rect.width; this.h = Math.max(360, rect.height);
      this.canvas.width = this.w * this.dpr; this.canvas.height = this.h * this.dpr;
      this.canvas.style.width = this.w + 'px'; this.canvas.style.height = this.h + 'px';
      const ctx = this.canvas.getContext('2d'); ctx.scale(this.dpr, this.dpr);
    }
    build() {
      const palette = { '文学类': '#e6923c', '艺术类': '#e07aa8', '历史': '#5aa6a8', '思政综合类': '#c79a3f', default: '#a87c45' };
      this.stars = this.books.map((b, i) => ({
        id: b.id, book: b,
        x: 0.06 + Math.random() * 0.88, y: 0.08 + Math.random() * 0.80,
        base: 0.6 + Math.random() * 1.6, phase: Math.random() * Math.PI * 2, speed: 0.5 + Math.random() * 1.5,
        color: palette[b.category] || palette.default,
        ring: 0, pulse: 0
      }));
      // 避免重叠：简单排斥迭代
      for (let k = 0; k < 30; k++) {
        for (let i = 0; i < this.stars.length; i++) {
          for (let j = i + 1; j < this.stars.length; j++) {
            const a = this.stars[i], c = this.stars[j];
            const dx = (a.x - c.x) * this.w, dy = (a.y - c.y) * this.h;
            const d = Math.hypot(dx, dy);
            const min = 42;
            if (d < min && d > 0) {
              const ux = dx / d, uy = dy / d; const f = (min - d) * 0.03 / this.w;
              a.x = Math.max(0.04, Math.min(0.96, a.x + ux * f)); a.y = Math.max(0.06, Math.min(0.94, a.y + uy * f));
              c.x = Math.max(0.04, Math.min(0.96, c.x - ux * f)); c.y = Math.max(0.06, Math.min(0.94, c.y - uy * f));
            }
          }
        }
      }
    }
    bind() {
      this.canvas.addEventListener('mousemove', e => {
        const rect = this.canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / this.w, my = (e.clientY - rect.top) / this.h;
        let hit = null, best = Infinity;
        this.stars.forEach(s => {
          const r = 5 + s.base * 3;
          const d = Math.hypot((s.x - mx) * this.w, (s.y - my) * this.h);
          if (d < r + 8 && d < best) { best = d; hit = s.id; }
        });
        this.hoverId = hit;
        this.canvas.style.cursor = hit ? 'pointer' : 'default';
      });
      this.canvas.addEventListener('click', e => {
        if (this.hoverId) location.hash = '#/book/' + this.hoverId;
      });
    }
    encounter() {
      if (!this.stars.length) return;
      const idx = Math.floor(Math.random() * this.stars.length);
      const s = this.stars[idx];
      this.encounterId = s.id;
      s.pulse = 1;
      setTimeout(() => { location.hash = '#/book/' + s.id; this.encounterId = null; s.pulse = 0; }, 900);
    }
    loop() {
      const ctx = this.canvas.getContext('2d');
      const t = performance.now() / 1000;
      ctx.clearRect(0, 0, this.w, this.h);
      // 背景星云
      const grad = ctx.createRadialGradient(this.w * 0.5, this.h * 0.4, 0, this.w * 0.5, this.h * 0.5, this.w * 0.8);
      grad.addColorStop(0, 'rgba(224,137,43,.06)'); grad.addColorStop(1, 'rgba(224,137,43,0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, this.w, this.h);
      // 星座连线（邻近星微弱连接）
      ctx.strokeStyle = 'rgba(194,106,59,.08)'; ctx.lineWidth = 1;
      for (let i = 0; i < this.stars.length; i++) {
        const a = this.stars[i];
        for (let j = i + 1; j < this.stars.length; j++) {
          const c = this.stars[j];
          const d = Math.hypot((a.x - c.x) * this.w, (a.y - c.y) * this.h);
          if (d < 70) { ctx.globalAlpha = 1 - d / 70; ctx.beginPath(); ctx.moveTo(a.x * this.w, a.y * this.h); ctx.lineTo(c.x * this.w, c.y * this.h); ctx.stroke(); }
        }
      }
      ctx.globalAlpha = 1;
      // 绘制星星
      this.stars.forEach(s => {
        const x = s.x * this.w, y = s.y * this.h;
        const twinkle = 0.7 + 0.3 * Math.sin(t * s.speed + s.phase);
        const hover = this.hoverId === s.id;
        const pulse = s.pulse > 0 ? (1 - s.pulse) * 12 : 0;
        const r = (3 + s.base * 2.2 + pulse) * (hover ? 1.35 : 1);
        const alpha = s.book.available > 0 ? 0.9 : 0.45;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = s.color; ctx.globalAlpha = alpha * twinkle;
        ctx.shadowColor = s.color; ctx.shadowBlur = hover ? 22 : (12 + pulse);
        ctx.fill(); ctx.shadowBlur = 0;
        // 光晕
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.5);
        g.addColorStop(0, s.color); g.addColorStop(1, 'transparent');
        ctx.fillStyle = g; ctx.globalAlpha = alpha * 0.18; ctx.beginPath(); ctx.arc(x, y, r * 2.5, 0, Math.PI * 2); ctx.fill();
        if (hover || this.encounterId === s.id) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--txt').trim() || '#3b2f23';
          ctx.font = '13px PingFang SC, Microsoft YaHei'; ctx.textAlign = 'center';
          const text = s.book.title.length > 10 ? s.book.title.slice(0, 9) + '…' : s.book.title;
          ctx.fillText(text, x, y + r + 18);
          ctx.fillStyle = 'rgba(138,117,90,.8)'; ctx.font = '11px PingFang SC, Microsoft YaHei';
          ctx.fillText((s.book.category || '') + ' · ' + (s.book.available > 0 ? '可借' : '已借完'), x, y + r + 32);
        }
      });
      ctx.globalAlpha = 1;
      // 脉冲衰减
      this.stars.forEach(s => { if (s.pulse > 0) s.pulse = Math.max(0, s.pulse - 0.05); });
      this.raf = requestAnimationFrame(() => this.loop());
    }
    destroy() {
      if (this.raf) cancelAnimationFrame(this.raf);
      if (this._ro) this._ro.disconnect();
    }
  }

  function coverBlock(book) {
    // 有自定义封面 URL 直接用；否则按索书号加载 /covers/<索书号>.jpg；缺图则生成设计感书封
    if (book.cover) {
      return `<div class="cover"><img src="${book.cover}" alt="" onerror="coverFallback(this)"></div>`;
    }
    if (book.call_no) {
      return `<div class="cover"><img src="${coverUrl(book.call_no)}" alt="" data-id="${book.id}" data-title="${esc(book.title)}" data-author="${esc(book.author)}" data-category="${esc(book.category)}" onerror="coverFallback(this)"></div>`;
    }
    return `<div class="cover"><div class="cover-art">${coverArtSVG(book)}</div></div>`;
  }
  function bookCard(b) {
    const ok = b.available > 0;
    const tags = (b.tags || '').split(',').filter(Boolean).slice(0, 3)
      .map(t => `<span class="tag">${t}</span>`).join('');
    return `<div class="book-card" data-id="${b.id}">
      <span class="stock ${ok ? 'ok' : 'no'}">${ok ? '可借 ' + b.available : '已借完'}</span>
      ${coverBlock(b)}
      <div class="book-body">
        <h3>${b.title}</h3>
        <div class="meta">${b.author || '未知'} · ${b.year || ''}</div>
        <div class="tagrow">${tags}</div>
      </div>
    </div>`;
  }
  function fmt(d) { return (d || '').slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

  // ---------------- 首页：知识星空 ----------------
  let f = { q: '', cat: '', page: 1 };
  let starScene = null;
  async function home() {
    const cats = await API.categories().catch(() => []);
    app().innerHTML = `
      <section class="hero">
        <h1>数字人文学院 <span class="g">知识星空</span></h1>
        <p>每一本书都是一颗星 · 在知识的星海中遇见下一场阅读奇遇</p>
        <div class="search-row">
          <input id="q" placeholder="搜索书名 / 作者 / 标签…" value="${f.q}">
          <button class="btn" id="s-btn">搜索</button>
          <button class="btn ai-search-btn" id="ai-btn">✨ AI 荐书</button>
          <button class="btn ghost" id="encounter-btn">🌠 星尘奇遇</button>
        </div>
        <div class="chips" id="chips">
          <span class="chip ${!f.cat ? 'active' : ''}" data-cat="">全部</span>
          ${cats.map(c => `<span class="chip ${f.cat === c.category ? 'active' : ''}" data-cat="${c.category}">${c.category} <em>${c.count}</em></span>`).join('')}
        </div>
      </section>
      <section class="story" id="story">
        <div class="story-cards" id="story-cards"><div class="empty" style="padding:18px">加载馆藏概览…</div></div>
        <div class="ticker" id="ticker"><span class="ticker-label">实时动态</span><div class="ticker-track" id="ticker-track"><span class="muted">连接中…</span></div></div>
      </section>
      <div class="star-wrap">
        <canvas id="star-canvas" class="star-canvas"></canvas>
        <div class="star-legend">
          <span><i class="dot lit"></i>可借</span>
          <span><i class="dot dim"></i>已借完</span>
          <span>✨ 点击星星查看图书</span>
        </div>
      </div>`;
    $('#ai-btn').addEventListener('click', () => { if (window.AIWidget) AIWidget.toggle(); });
    $('#encounter-btn').addEventListener('click', () => { if (starScene) starScene.encounter(); });
    $('#q').addEventListener('input', e => { f.q = e.target.value; loadStars(); });
    $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') loadStars(); });
    $('#s-btn').addEventListener('click', loadStars);
    $('#chips').addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      f.cat = c.dataset.cat;
      $$('#chips .chip').forEach(x => x.classList.toggle('active', x === c));
      loadStars();
    });
    loadStory();
    startTicker();
    await loadStars();
  }
  async function loadStars() {
    const wrap = $('.star-wrap'); if (!wrap) return;
    wrap.classList.add('loading');
    const r = await API.stars({ q: f.q, category: f.cat });
    wrap.classList.remove('loading');
    const canvas = $('#star-canvas');
    if (starScene) starScene.destroy();
    starScene = new StarScene(canvas, r.stars || []);
  }

  async function loadStory() {
    const box = $('#story-cards'); if (!box) return;
    try {
      const o = await API.overview();
      const top = (o.categories && o.categories[0]) ? o.categories[0] : null;
      const cards = [
        { k: '馆藏种数', v: o.totalBooks, c: 'var(--accent)' },
        { k: '馆藏册数', v: o.totalCopies, c: 'var(--ai)' },
        { k: '可借册数', v: o.availableCopies, c: 'var(--green)' },
        { k: '近30天借阅', v: o.monthBorrow, c: 'var(--amber)' },
        { k: '最大分类', v: top ? top.category : '—', c: 'var(--cyan)' }
      ];
      box.innerHTML = cards.map(c => `<div class="story-card"><div class="v" ${c.c ? `style="color:${c.c}"` : ''}>${c.v}</div><div class="k">${c.k}</div></div>`).join('');
    } catch (e) { box.innerHTML = ''; }
  }
  let _tickerTimer = null;
  function startTicker() {
    const track = $('#ticker-track'); if (!track) return;
    const render = async () => {
      try {
        const r = await API.activity(8);
        const items = (r.activity || []).map(a => `<span class="tk"><b>${esc(a.title)}</b> ${esc(a.action)}</span>`);
        track.innerHTML = items.length ? items.join('<span class="tk-sep">·</span>') : '<span class="muted">暂无动态</span>';
      } catch (e) {}
    };
    render();
    if (_tickerTimer) clearInterval(_tickerTimer);
    _tickerTimer = setInterval(render, 6000);
  }

  // ---------------- 图书详情 ----------------
  async function bookDetail(id) {
    const r = await API.book(id);
    const b = r.book;
    const ok = b.available > 0;
    const tags = (b.tags || '').split(',').filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');
    const isReader = State.user && State.user.role === '读者';
    // 查询当前读者是否已有该书的进行中记录，保持状态联动
    let mine = null;
    if (isReader) {
      try {
        const mb = await API.myBorrows();
        mine = (mb.borrows || []).find(x => String(x.book_id) === String(b.id));
      } catch (e) {}
    }
    const actionArea = (rec) => {
      if (!State.user) return `<p class="muted">请先 <a href="#/login">登录读者账号</a> 后申请借阅。</p>`;
      if (!isReader) return `<p class="muted">当前账号为「${State.user.role}」，仅读者可申请借阅。</p>`;
      if (rec) {
        if (rec.status === '待审批') return `<button class="btn ghost" data-cancel="${rec.id}">取消申请</button><span class="status pending-tip">已提交，等待管理员审批</span>`;
        if (rec.status === '待取书') return `<span class="status 待取书">已通过审批 · 请到图书室取书</span>`;
        if (rec.status === '借出' || rec.status === '逾期') return `<span class="status ${rec.status}">${rec.status} · 应还 ${fmt(rec.due_date)}</span>`;
        if (rec.status === '已拒绝') return `<span class="status 已拒绝">申请未通过${rec.reject_reason ? '：' + rec.reject_reason : ''}</span>`;
        if (rec.status === '已取消') return `<button class="btn" id="borrow-btn" ${ok ? '' : 'disabled'}>${ok ? '重新申请借阅' : '已借完'}</button>`;
        if (rec.status === '已还') return `<button class="btn" id="borrow-btn" ${ok ? '' : 'disabled'}>${ok ? '再次借阅' : '已借完'}</button>`;
      }
      return ok
        ? `<button class="btn" id="borrow-btn">申请借阅</button>`
        : `<button class="btn" id="borrow-btn" disabled>已借完</button><span class="muted">库存为 0，审批通过后到馆取书</span>`;
    };
    app().innerHTML = `
      <a class="btn ghost sm" href="#/home">← 返回馆藏</a>
      <div class="detail" style="margin-top:14px">
        ${coverBlock(b)}
        <div>
          <h1>${b.title}</h1>
          <div class="line">作者：${b.author || '未知'}</div>
          <div class="line">出版：${b.publisher || '—'} ${b.year ? '· ' + b.year : ''}</div>
          <div class="line">分类：${b.category || '—'} ｜ 馆藏位置：${b.location || '—'}</div>
          <div class="line">索书号：${b.call_no || '—'} ｜ 定价：¥${b.price || '—'}</div>
          <div class="line">ISBN：${b.isbn || '—'} ｜ 馆藏：${b.available}/${b.total}</div>
          <div class="tagrow" style="margin:12px 0">${tags}</div>
          <div class="intro">${b.intro || '暂无简介。'}</div>
          <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn ghost sm" id="digest-btn">✨ AI 导读</button>
          </div>
          <div id="digest-box" class="digest-box"></div>
          <div id="action-area" style="margin-top:16px">${actionArea(mine)}</div>
          <p class="muted" style="font-size:12px;margin-top:10px">借阅流程：提交申请 → 管理员审批 → 到馆取书（借期 ${'30'} 天）</p>
        </div>
      </div>
      <div class="section-title">相关推荐</div>
      <div class="grid">${r.related.length ? r.related.map(bookCard).join('') : '<div class="empty">暂无相关图书</div>'}</div>
      <div class="section-title">读者评论 <span class="muted" style="font-size:13px">（AI 自动情感分析与标签提取）</span></div>
      <div id="review-insights" class="review-insights"></div>
      <div id="comment-list"></div>
      <div id="comment-form" class="comment-form hidden">
        <textarea id="comment-input" rows="2" placeholder="写下你的读后感…"></textarea>
        <button class="btn sm" id="comment-send">发表评论</button>
      </div>`;
    renderComments(b.id);
    const rebind = () => {
      const bb = $('#borrow-btn');
      if (bb) bb.onclick = async () => {
        bb.disabled = true; bb.textContent = '提交中…';
        try { await API.borrow(b.id); toast('申请已提交，等待管理员审批', 'ok'); bookDetail(b.id); }
        catch (e) { toast(e.message, 'err'); bb.disabled = false; bb.textContent = '申请借阅'; }
      };
      const cb = $('[data-cancel]');
      if (cb) cb.onclick = async () => {
        cb.disabled = true;
        try { await API.cancelBorrow(cb.dataset.cancel); toast('已取消申请', 'ok'); bookDetail(b.id); }
        catch (e) { toast(e.message, 'err'); cb.disabled = false; }
      };
      const db2 = $('#digest-btn');
      if (db2 && !db2.dataset.bound) {
        db2.dataset.bound = '1';
        db2.onclick = async () => {
          const box = $('#digest-box'); db2.disabled = true; db2.textContent = '生成中…';
          try {
            const r = await API.digest(b.id);
            const rel = (r.books && r.books.length)
              ? '<div class="digest-rel">延伸阅读：' + r.books.map(x => `<a href="#/book/${x.id}">《${esc(x.title)}》</a>`).join('、') + '</div>'
              : '';
            box.innerHTML = `<div class="digest"><div class="digest-h">✨ AI 导读</div><div class="digest-body">${esc(r.reply).replace(/\n/g, '<br>')}</div>${rel}</div>`;
            db2.textContent = '✨ 重新导读';
          } catch (e) { toast(e.message, 'err'); db2.textContent = '✨ AI 导读'; }
          db2.disabled = false;
        };
      }
    };
    rebind();
    async function renderComments(bookId) {
      const list = $('#comment-list');
      const form = $('#comment-form');
      if (State.user) form.classList.remove('hidden');
      try {
        const cm = await API.comments(bookId);
        const ins = await API.reviewInsights(bookId);
        const sentimentBar = ins.n
          ? `<div class="sentiment-bar"><div class="pos" style="width:${(ins.pos / ins.n * 100).toFixed(1)}%"></div><div class="neg" style="width:${(ins.neg / ins.n * 100).toFixed(1)}%"></div></div>
             <p class="muted" style="font-size:12px">共 ${ins.n} 条评论 · 正面 ${ins.pos} · 负面 ${ins.neg} · 平均情感 ${ins.avg}</p>`
          : '<p class="muted" style="font-size:12px">暂无评论，成为第一个评论者吧。</p>';
        const tags = (ins.topTags || []).map(t => `<span class="tag">${t.tag} ${t.count}</span>`).join('');
        $('#review-insights').innerHTML = `<div class="insights-card">${sentimentBar}<div class="tagrow">${tags}</div></div>`;
        list.innerHTML = (cm.comments || []).length
          ? cm.comments.map(c => `<div class="comment-item">
              <div class="comment-head"><b>${esc(c.user_name || '匿名读者')}</b><span class="muted">${fmt(c.created_at)}</span>
                ${c.sentiment != null ? `<span class="sentiment ${c.sentiment > 0.2 ? 'pos' : (c.sentiment < -0.2 ? 'neg' : 'neu')}">${c.sentiment > 0.2 ? '正面' : (c.sentiment < -0.2 ? '负面' : '中性')}</span>` : ''}
              </div>
              <p>${esc(c.content)}</p>
              ${c.tags ? '<div class="tagrow">' + c.tags.split(',').map(t => `<span class="tag">${esc(t)}</span>`).join('') + '</div>' : ''}
            </div>`).join('')
          : '<div class="empty" style="padding:20px">暂无评论</div>';
      } catch (e) { list.innerHTML = '<div class="empty">评论加载失败</div>'; }
      const send = $('#comment-send');
      if (send) send.onclick = async () => {
        const inp = $('#comment-input'); const txt = inp.value.trim(); if (!txt) return;
        send.disabled = true;
        try { await API.postComment(bookId, txt); inp.value = ''; await renderComments(bookId); toast('评论已发布', 'ok'); }
        catch (e) { toast(e.message, 'err'); }
        send.disabled = false;
      };
    }
  }

  // ---------------- 登录 / 注册 ----------------
  function login() {
    app().innerHTML = `<div class="card" style="max-width:440px;margin:20px auto">
      <h3 style="margin-bottom:6px">读者登录</h3>
      <p class="muted" style="font-size:13px;margin-bottom:16px">读者账号用于检索馆藏、申请借阅、与 AI 助手互动。</p>
      <div class="form">
        <label>账号</label><input id="u" placeholder="用户名">
        <label>密码</label><input id="p" type="password" placeholder="密码">
        <button class="btn" id="go">登录</button>
        <p class="muted" style="font-size:13px">还没有账号？<a href="#/register">立即注册</a></p>
        <div class="form-divider"><span>其他入口</span></div>
        <a class="btn ghost" href="#/admin-login" style="text-align:center">我是管理员 / 馆员 → 管理登录</a>
        <p class="muted" style="font-size:12px">馆员演示：librarian / lib12345 ｜ 管理员：admin / admin123</p>
      </div></div>`;
    const submit = async () => {
      try { const r = await API.login($('#u').value, $('#p').value); State.set(r.token, r.user); toast('登录成功', 'ok'); route(); }
      catch (e) { toast(e.message, 'err'); }
    };
    $('#go').onclick = submit; $('#p').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }
  // 管理员 / 馆员 独立登录入口
  function adminLogin() {
    if (State.user && (State.user.role === '馆员' || State.user.role === '管理员')) { location.hash = '#/admin'; return; }
    app().innerHTML = `<div class="card admin-login-card" style="max-width:460px;margin:20px auto">
      <div class="admin-login-head">
        <div class="logo-mini">馆</div>
        <div><h3 style="margin:0">管理后台登录</h3><p class="muted" style="font-size:12px;margin:2px 0 0">馆员 / 管理员专用 · 审批借阅 · 数据看板</p></div>
      </div>
      <div class="form" style="margin-top:16px">
        <label>账号</label><input id="u" placeholder="管理员或馆员账号">
        <label>密码</label><input id="p" type="password" placeholder="密码">
        <button class="btn" id="go">进入管理后台</button>
        <p class="muted" style="font-size:12px">演示账号 ｜ 管理员：admin / admin123 ｜ 馆员：librarian / lib12345</p>
        <div class="form-divider"><span>其他入口</span></div>
        <a class="btn ghost" href="#/login" style="text-align:center">我是读者 → 读者登录</a>
      </div></div>`;
    const submit = async () => {
      try {
        const r = await API.login($('#u').value, $('#p').value);
        if (r.user.role === '读者') { toast('该账号为读者，请使用读者登录', 'err'); location.hash = '#/login'; return; }
        State.set(r.token, r.user); toast('欢迎回到管理后台', 'ok'); location.hash = '#/admin';
      } catch (e) { toast(e.message, 'err'); }
    };
    $('#go').onclick = submit; $('#p').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }
  function register() {
    app().innerHTML = `<div class="card" style="max-width:460px;margin:20px auto">
      <h3 style="margin-bottom:16px">读者注册</h3>
      <div class="form">
        <div class="form-row"><div><label>账号 *</label><input id="u" placeholder="用于登录"></div>
          <div><label>密码 *</label><input id="p" type="password" placeholder="至少6位"></div></div>
        <label>姓名</label><input id="n" placeholder="真实姓名">
        <div class="form-row"><div><label>院系</label><input id="d" placeholder="如 数字人文学院"></div>
          <div><label>学号</label><input id="s" placeholder="学号/工号"></div></div>
        <button class="btn" id="go">注册并登录</button>
        <p class="muted" style="font-size:13px">已有账号？<a href="#/login">去登录</a></p>
      </div></div>`;
    const submit = async () => {
      try {
        const r = await API.register($('#u').value, $('#p').value, $('#n').value, $('#d').value, $('#s').value);
        State.set(r.token, r.user); toast('注册成功', 'ok'); route();
      } catch (e) { toast(e.message, 'err'); }
    };
    $('#go').onclick = submit;
  }

  // ---------------- 我的借阅 ----------------
  async function my() {
    if (!State.user) { location.hash = '#/login'; return; }
    const r = await API.myBorrows();
    const list = r.borrows;
    const groups = {
      pending: list.filter(b => b.status === '待审批'),
      pickup: list.filter(b => b.status === '待取书'),
      active: list.filter(b => b.status === '借出' || b.status === '逾期'),
      done: list.filter(b => b.status === '已还' || b.status === '已拒绝' || b.status === '已取消')
    };
    const renderItem = (b) => {
      const ini = (b.title || '?').slice(0, 1);
      const overdue = b.isOverdue;
      const left = overdue ? `逾期 ${Math.abs(daysBetween(new Date(), b.due_date))} 天` : (b.due_date ? `剩 ${daysBetween(new Date(), b.due_date)} 天` : '');
      let action = '';
      if (b.status === '待审批') action = `<button class="btn ghost sm" data-cancel="${b.id}">取消申请</button>`;
      else if (b.status === '借出' || b.status === '逾期') action = `<button class="btn ghost sm" data-ret="${b.id}">归还</button>`;
      else if (b.status === '待取书') action = `<span class="muted" style="font-size:12px">请到馆取书</span>`;
      const sub = b.status === '借出' || b.status === '逾期'
        ? `${b.author || ''} ｜ 借期至 ${fmt(b.due_date)} · <span class="${overdue ? 'overdue-flag' : 'muted'}">${left}</span>`
        : `${b.author || ''} ｜ ${b.category || ''}`;
      return `<div class="borrow-item">
        <div class="mini" style="background:${colorFor(b.title)}">${ini}</div>
        <div class="info"><h4>${b.title}</h4><p>${sub}</p></div>
        <span class="status ${b.status}">${b.status}</span>${action}
      </div>`;
    };
    const tabs = [
      ['pending', '待审批', groups.pending],
      ['pickup', '待取书', groups.pickup],
      ['active', '在借', groups.active],
      ['done', '历史', groups.done]
    ];
    app().innerHTML = `<h2 style="margin-bottom:14px">我的借阅</h2>
      <div class="tabs">
        ${tabs.map(([k, t, arr]) => `<span class="tab ${k === 'pending' ? 'active' : ''}" data-t="${k}">${t} (${arr.length})</span>`).join('')}
      </div>
      <div id="borrow-list">${groups.pending.length ? groups.pending.map(renderItem).join('') : '<div class="empty">暂无待审批申请</div>'}</div>`;
    const fill = (k) => {
      const arr = groups[k] || [];
      $('#borrow-list').innerHTML = arr.length ? arr.map(renderItem).join('') : '<div class="empty">暂无记录</div>';
      bind();
    };
    $$('.tab').forEach(t => t.onclick = () => {
      $$('.tab').forEach(x => x.classList.toggle('active', x === t));
      fill(t.dataset.t);
    });
    function bind() {
      $$('[data-ret]').forEach(btn => btn.onclick = async () => {
        btn.disabled = true;
        try { await API.retbook(btn.dataset.ret); toast('已归还', 'ok'); my(); } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
      });
      $$('[data-cancel]').forEach(btn => btn.onclick = async () => {
        btn.disabled = true;
        try { await API.cancelBorrow(btn.dataset.cancel); toast('已取消申请', 'ok'); my(); } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
      });
    }
    bind();
  }

  // ---------------- 馆员看板 ----------------
  async function admin() {
    const r = await API.stats();
    const k = r.kpi;
    app().innerHTML = `<h2 style="margin-bottom:4px;display:flex;align-items:center;gap:10px">数据看板 <span class="ai-pill" id="ai-pill">AI · …</span></h2>
      <p class="muted" style="font-size:13px;margin-bottom:12px">馆藏运营概览 · 实时统计</p>
      <div style="margin-bottom:16px"><a class="btn ghost sm" href="#/screen">🖥 查看数据大屏</a></div>
      <div class="kpi-grid">
        ${kpi('馆藏种数', k.totalBooks)}${kpi('馆藏册数', k.totalCopies)}
        ${kpi('可借册数', k.availableCopies)}${kpi('在借册数', k.borrowed)}
        ${kpi('待审批', k.pending, k.pending > 0 ? 'var(--amber)' : '')}${kpi('待取书', k.pickup)}
        ${kpi('逾期册数', k.overdue, k.overdue > 0 ? 'var(--red)' : '')}
        ${kpi('逾期率', k.overdueRate + '%')}${kpi('读者数', k.readers)}
        ${kpi('馆员数', k.librarians)}${kpi('累计借阅', k.returned + k.borrowed)}
      </div>
      <div class="chart-grid">
        <div class="card"><div class="panel-title">近 14 天借阅趋势</div><canvas id="c-trend" height="240"></canvas></div>
        <div class="card"><div class="panel-title">借阅状态分布</div><canvas id="c-donut" height="240"></canvas></div>
        <div class="card"><div class="panel-title">分类分布</div><canvas id="c-cat" height="240"></canvas></div>
        <div class="card"><div class="panel-title">热门书目 Top10</div><div id="top-books"></div></div>
      </div>`;
    Charts.line($('#c-trend'), r.trend);
    const STATUS_COLOR = { '待审批': '#d99a2b', '待取书': '#cf7d3a', '借出': '#c2693b', '逾期': '#c5524a', '已还': '#5a9e5a', '已拒绝': '#b09a7e', '已取消': '#c9b79c' };
    const bd = (r.breakdown || []).filter(x => x.c > 0);
    Charts.donut($('#c-donut'), bd.length ? bd.map(x => ({ label: x.status, value: x.c, color: STATUS_COLOR[x.status] || '#b09a7e' })) : [{ label: '暂无', value: 1, color: '#e3d6c2' }]);
    Charts.hbars($('#c-cat'), r.categories.map(c => ({ label: c.category, value: c.c })));
    $('#top-books').innerHTML = r.topBooks.length
      ? r.topBooks.map((b, i) => `<div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid var(--line)">
          <span>${i + 1}. ${b.title} <small class="muted">${b.author || ''}</small></span><b style="color:var(--cyan)">${b.c}</b></div>`).join('')
      : '<div class="empty">暂无借阅记录</div>';
    API.aiStatus().then(s => {
      const p = $('#ai-pill'); if (p) { p.textContent = 'AI · ' + (s.online ? '真实模型在线' : '离线规则'); p.className = 'ai-pill ' + (s.online ? 'on' : 'off'); }
    }).catch(() => {});
  }

  // ---------------- 馆员编目 ----------------
  async function adminCatalog() {
    app().innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2>图书编目</h2><button class="btn" id="add">+ 新增图书</button></div>
      <div class="search-row" style="margin-top:0"><input id="q" placeholder="检索书名/作者…"><button class="btn ghost" id="s">查询</button></div>
      <div class="card" style="padding:0;overflow:auto"><table>
        <thead><tr><th>书名</th><th>索书号</th><th>作者</th><th>分类</th><th>馆藏</th><th>操作</th></tr></thead>
        <tbody id="rows"></tbody></table></div>`;
    const load = async () => {
      const rows = $('#rows'); rows.innerHTML = '<tr><td colspan="6"><div class="empty"><span class="spin"></span></div></td></tr>';
      const r = await API.books({ q: $('#q').value, pageSize: 100 });
      rows.innerHTML = r.books.map(b => `<tr>
        <td>${b.title}</td><td class="mono">${b.call_no || ''}</td><td>${b.author || ''}</td><td>${b.category || ''}</td>
        <td>${b.available}/${b.total}</td>
        <td class="row-actions"><button class="btn ghost sm" data-edit="${b.id}">编辑</button>
          <button class="btn ghost sm" data-del="${b.id}">删除</button></td></tr>`).join('');
      $$('[data-edit]').forEach(b => b.onclick = () => editBook(b.dataset.edit));
      $$('[data-del]').forEach(b => b.onclick = async () => {
        if (!confirm('确认删除《' + b.closest('tr').firstChild.textContent + '》？')) return;
        try { await API.deleteBook(b.dataset.del); toast('已删除', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
      });
    };
    $('#s').onclick = load; $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
    $('#add').onclick = () => editBook(null);
    await load();

    async function editBook(id) {
      const b = id ? await API.book(id).then(r => r.book) : {};
      const curCover = b.cover || (b.call_no ? coverUrl(b.call_no) : '');
      let pendingCover = '';
      openModal(`<h3>${id ? '编辑图书' : '新增图书'}</h3>
        <div class="form">
          <label>书名 *</label><input id="t" value="${b.title || ''}">
          <label>索书号（用于封面与按编码添加）</label><input id="cn" value="${b.call_no || ''}" placeholder="如 I1-01">
          <div class="form-row"><div><label>作者</label><input id="a" value="${b.author || ''}"></div>
            <div><label>ISBN</label><input id="isbn" value="${b.isbn || ''}"></div></div>
          <div class="form-row"><div><label>出版社</label><input id="pub" value="${b.publisher || ''}"></div>
            <div><label>出版年</label><input id="yr" value="${b.year || ''}"></div></div>
          <div class="form-row"><div><label>分类</label><input id="cat" value="${b.category || ''}"></div>
            <div><label>馆藏位置</label><input id="loc" value="${b.location || ''}"></div></div>
          <label>标签（逗号分隔）</label><input id="tags" value="${b.tags || ''}">
          <label>定价（元）</label><input id="price" value="${b.price || ''}" placeholder="如 39.80">
          <label>总册数</label><input id="tot" type="number" value="${b.total || 1}">
          <label>封面图片</label>
          <div class="cover-edit">
            <div class="cover-preview" id="cover-prev">${curCover ? `<img src="${curCover}" onerror="this.style.display='none'">` : '<span class="muted">暂无封面</span>'}</div>
            <div class="cover-actions">
              <label class="btn ghost sm" style="display:inline-block">选择图片<input id="cv-file" type="file" accept="image/*" hidden></label>
              <button class="btn ghost sm" id="cv-clear">清除</button>
            </div>
            <input id="cv-url" placeholder="或粘贴图片 URL（http…）">
          </div>
          <label>简介</label><textarea id="intro" rows="3">${b.intro || ''}</textarea>
          <button class="btn" id="save">保存</button>
        </div>`);
      const prev = $('#cover-prev');
      const setPrev = (src) => { prev.innerHTML = src ? `<img src="${src}" onerror="this.style.display='none'">` : '<span class="muted">暂无封面</span>'; };
      $('#cv-file').onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        if (file.size > 8 * 1024 * 1024) { toast('图片过大（上限 8MB）', 'err'); return; }
        const dataUrl = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(file); });
        pendingCover = dataUrl; setPrev(dataUrl); toast('已选择，保存后上传', 'ok');
      };
      $('#cv-url').addEventListener('input', e => { const u = e.target.value.trim(); if (u) { pendingCover = u; setPrev(u); } });
      $('#cv-clear').onclick = () => { pendingCover = ''; setPrev(''); $('#cv-url').value = ''; $('#cv-file').value = ''; };
      $('#save').onclick = async () => {
        const payload = {
          title: $('#t').value, call_no: $('#cn').value, isbn: $('#isbn').value, author: $('#a').value, publisher: $('#pub').value,
          year: $('#yr').value, category: $('#cat').value, price: $('#price').value, location: $('#loc').value, tags: $('#tags').value,
          total: $('#tot').value, intro: $('#intro').value
        };
        try {
          let savedId = id;
          if (id) await API.updateBook(id, payload); else { const r = await API.createBook(payload); savedId = r.book.id; }
          // 封面上传（新增书也能上传）
          if (pendingCover) {
            try { await API.uploadCover(savedId, pendingCover); } catch (e) { toast('信息已保存，但封面上传失败：' + e.message, 'err'); }
          }
          closeModal(); toast('已保存', 'ok'); load();
        } catch (e) { toast(e.message, 'err'); }
      };
    }
  }

  // ---------------- 馆员导入 ----------------
  function adminImport() {
    app().innerHTML = `<h2 style="margin-bottom:4px">批量导入书目</h2>
      <p class="muted" style="font-size:13px;margin-bottom:14px">支持 JSON 或 CSV，字段：title,call_no,isbn,author,publisher,year,price,category,tags,location,intro,total（call_no 索书号为主键，用于按编码添加与封面加载）</p>
      <div class="card">
        <div class="form-row" style="margin-bottom:14px">
          <a class="btn ghost sm" href="/data/import-template.json" download>下载 JSON 模板</a>
          <label class="btn ghost sm" style="display:inline-block">选择文件<input id="file" type="file" accept=".json,.csv" hidden></label>
        </div>
        <div class="form-row" style="margin-bottom:14px">
          <select id="fmt"><option value="json">JSON</option><option value="csv">CSV</option></select>
          <select id="mode"><option value="add">仅新增</option><option value="update">按索书号更新</option></select>
        </div>
        <label>数据（也可直接粘贴到此处）</label>
        <textarea id="data" rows="10" placeholder='[{"title":"示例书名","author":"作者","category":"数字人文","total":2}]'></textarea>
        <button class="btn" id="imp" style="margin-top:14px">导入</button>
        <div id="imp-result" class="muted" style="margin-top:12px;font-size:13px"></div>
      </div>`;
    $('#file').onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      const text = await file.text();
      $('#data').value = text;
      $('#fmt').value = file.name.endsWith('.csv') ? 'csv' : 'json';
    };
    $('#imp').onclick = async () => {
      const data = $('#data').value.trim(); if (!data) return toast('请先提供数据', 'err');
      $('#imp').disabled = true; $('#imp').textContent = '导入中…';
      try {
        const r = await API.importBooks($('#fmt').value, $('#mode').value, data);
        $('#imp-result').innerHTML = `导入完成 ✅ 新增 ${r.added} 本，更新 ${r.updated} 本，跳过 ${r.skipped} 本。`;
        toast('导入成功', 'ok');
      } catch (e) { toast(e.message, 'err'); $('#imp-result').textContent = '失败：' + e.message; }
      $('#imp').disabled = false; $('#imp').textContent = '导入';
    };
  }

  // ---------------- 读者管理 ----------------
  async function adminReaders() {
    const isAdmin = State.user && State.user.role === '管理员';
    const r = await API.readers();
    app().innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2>读者管理</h2>${isAdmin ? '<button class="btn" id="add">+ 新建账号</button>' : ''}</div>
      <div class="card" style="padding:0;overflow:auto"><table>
        <thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>院系</th><th>在借</th><th>额度</th>${isAdmin ? '<th>操作</th>' : ''}</tr></thead>
        <tbody id="rows"></tbody></table></div>`;
    $('#rows').innerHTML = r.readers.map(u => `<tr data-id="${u.id}">
      <td>${u.username}</td><td>${u.name || ''}</td><td><span class="role-badge">${u.role}</span></td>
      <td>${u.dept || ''}</td><td>${u.active || 0}</td><td>${u.max_borrow}</td>
      ${isAdmin ? `<td class="row-actions"><button class="btn ghost sm" data-role="${u.id}">改角色</button>
        <button class="btn ghost sm" data-quota="${u.id}">改额度</button></td>` : ''}
    </tr>`).join('');
    if (isAdmin) {
      $('#add').onclick = () => openModal(`<h3>新建账号</h3><div class="form">
        <label>账号 *</label><input id="u"><label>密码 *</label><input id="p" type="password">
        <label>姓名</label><input id="n"><label>角色</label>
        <select id="role"><option>读者</option><option>馆员</option><option>管理员</option></select>
        <label>借阅额度</label><input id="mb" type="number" value="5">
        <button class="btn" id="save">创建</button></div>`);
      $('#save').onclick = async () => {
        try { await API.addReader($('#u').value, $('#p').value, $('#n').value, $('#role').value, $('#mb').value);
          closeModal(); toast('已创建', 'ok'); adminReaders(); } catch (e) { toast(e.message, 'err'); }
      };
      $$('[data-role]').forEach(b => b.onclick = async () => {
        const v = prompt('设置角色（读者/馆员/管理员）：', '馆员'); if (!v) return;
        try { await API.updateReader(b.dataset.role, { role: v }); toast('已更新', 'ok'); adminReaders(); } catch (e) { toast(e.message, 'err'); }
      });
      $$('[data-quota]').forEach(b => b.onclick = async () => {
        const v = prompt('设置借阅额度：', '5'); if (!v) return;
        try { await API.updateReader(b.dataset.quota, { max_borrow: v }); toast('已更新', 'ok'); adminReaders(); } catch (e) { toast(e.message, 'err'); }
      });
    }
  }

  // ---------------- 审批台（馆员+） ----------------
  async function adminLoans() {
    const tabs = [
      ['待审批', '待审批'], ['待取书', '待取书'], ['借出', '在借'], ['', '全部']
    ];
    app().innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2>借阅审批台</h2>
        <span class="muted" style="font-size:13px">读者申请 → 审批通过 → 到馆取书</span></div>
      <div class="tabs" id="loan-tabs">
        ${tabs.map(([s, t], i) => `<span class="tab ${i === 0 ? 'active' : ''}" data-s="${s}">${t}</span>`).join('')}
      </div>
      <div id="loan-list"><div class="empty"><span class="spin"></span> 加载中…</div></div>`;
    const renderRow = (r) => {
      const ini = (r.title || '?').slice(0, 1);
      let act = '';
      if (r.status === '待审批') act = `<button class="btn sm" data-approve="${r.id}">通过</button>
        <button class="btn ghost sm" data-reject="${r.id}">拒绝</button>`;
      else if (r.status === '待取书') act = `<button class="btn sm" data-pickup="${r.id}">确认取书</button>`;
      else if (r.status === '借出' || r.status === '逾期') act = `<button class="btn ghost sm" data-return="${r.id}">归还</button>`;
      return `<div class="borrow-item loan-row">
        <div class="mini" style="background:${colorFor(r.title)}">${ini}</div>
        <div class="info"><h4>${r.title} <small class="muted">${r.author || ''}</small></h4>
          <p>申请人：${r.user_name || r.username}${r.dept ? ' · ' + r.dept : ''} ｜ 申请于 ${fmt(r.request_date)}</p>
          <p class="muted" style="font-size:12px">索书号：${r.call_no || '—'} ｜ 位置：${r.location || '—'}${r.reject_reason ? ' ｜ 拒绝原因：' + r.reject_reason : ''}</p></div>
        <span class="status ${r.status}">${r.status}</span>${act}
      </div>`;
    };
    const load = async (status) => {
      const box = $('#loan-list'); if (!box) return;
      box.innerHTML = '<div class="empty"><span class="spin"></span> 加载中…</div>';
      const r = await API.adminLoans(status);
      const rows = r.loans || [];
      box.innerHTML = rows.length ? rows.map(renderRow).join('') : '<div class="empty">暂无相关借阅记录</div>';
      bind();
    };
    const bind = () => {
      $$('[data-approve]').forEach(b => b.onclick = async () => {
        b.disabled = true; try { await API.approveLoan(b.dataset.approve); toast('已通过，等待读者到馆取书', 'ok'); load('待审批'); } catch (e) { toast(e.message, 'err'); b.disabled = false; }
      });
      $$('[data-reject]').forEach(b => b.onclick = async () => {
        const reason = prompt('填写拒绝原因（可选）：', ''); if (reason === null) return;
        b.disabled = true; try { await API.rejectLoan(b.dataset.reject, reason); toast('已拒绝', 'ok'); load('待审批'); } catch (e) { toast(e.message, 'err'); b.disabled = false; }
      });
      $$('[data-pickup]').forEach(b => b.onclick = async () => {
        b.disabled = true; try { await API.pickupLoan(b.dataset.pickup); toast('已确认取书，借期开始', 'ok'); load('待取书'); } catch (e) { toast(e.message, 'err'); b.disabled = false; }
      });
      $$('[data-return]').forEach(b => b.onclick = async () => {
        b.disabled = true; try { await API.retbook(b.dataset.return); toast('已归还', 'ok'); load('借出'); } catch (e) { toast(e.message, 'err'); b.disabled = false; }
      });
    };
    $$('#loan-tabs .tab').forEach(t => t.onclick = () => {
      $$('#loan-tabs .tab').forEach(x => x.classList.toggle('active', x === t));
      load(t.dataset.s);
    });
    await load('待审批');
  }

  // ---------------- 数据大屏（馆员+） ----------------
  async function screen() {
    const r = await API.stats();
    const k = r.kpi;
    const rel = (d) => d >= 1 ? (Math.floor(d) + ' 天前') : (Math.max(0, Math.round(d * 24)) + ' 小时前');
    const now = Date.now();
    app().innerHTML = `<div class="screen">
      <div class="screen-head">
        <div><h2>数字人文学院图书室 · 数据大屏</h2><span class="muted">实时运营全景 · 每 5 秒自动刷新</span></div>
        <a class="btn ghost sm" href="#/admin">← 返回看板</a>
      </div>
      <div class="kpi-grid screen-kpi">
        ${kpi('馆藏种数', k.totalBooks)}${kpi('馆藏册数', k.totalCopies)}
        ${kpi('可借册数', k.availableCopies)}${kpi('在借', k.borrowed)}
        ${kpi('待审批', k.pending, k.pending > 0 ? 'var(--amber)' : '')}${kpi('待取书', k.pickup)}
        ${kpi('逾期', k.overdue, k.overdue > 0 ? 'var(--red)' : '')}${kpi('读者数', k.readers)}
      </div>
      <div class="screen-grid">
        <div class="card screen-card"><div class="panel-title">近 14 天借阅趋势</div><canvas id="s-trend" height="260"></canvas></div>
        <div class="card screen-card"><div class="panel-title">借阅状态分布</div><canvas id="s-donut" height="260"></canvas></div>
        <div class="card screen-card"><div class="panel-title">分类分布</div><canvas id="s-cat" height="260"></canvas></div>
        <div class="card screen-card feed"><div class="panel-title">实时借阅动态</div><div id="s-feed" class="feed-list"><div class="empty" style="padding:20px">加载中…</div></div></div>
      </div>
    </div>`;
    Charts.line($('#s-trend'), r.trend);
    const STATUS_COLOR = { '待审批': '#d99a2b', '待取书': '#cf7d3a', '借出': '#c2693b', '逾期': '#c5524a', '已还': '#5a9e5a', '已拒绝': '#b09a7e', '已取消': '#c9b79c' };
    const bd = (r.breakdown || []).filter(x => x.c > 0);
    Charts.donut($('#s-donut'), bd.length ? bd.map(x => ({ label: x.status, value: x.c, color: STATUS_COLOR[x.status] || '#b09a7e' })) : [{ label: '暂无', value: 1, color: '#e3d6c2' }]);
    Charts.hbars($('#s-cat'), r.categories.map(c => ({ label: c.category, value: c.c })));
    const feedBox = $('#s-feed');
    const renderFeed = async () => {
      try {
        const a = await API.activity(12);
        feedBox.innerHTML = (a.activity || []).map(x => {
          const d = (now - new Date(x.ts).getTime()) / 86400000;
          return `<div class="feed-item"><span class="status ${x.status}">${x.status}</span><b>${esc(x.title)}</b><span class="muted">${esc(x.action)} · ${rel(Math.max(0, d))}</span></div>`;
        }).join('') || '<div class="empty">暂无动态</div>';
      } catch (e) {}
    };
    renderFeed();
    if (window._screenTimer) clearInterval(window._screenTimer);
    window._screenTimer = setInterval(renderFeed, 5000);
  }

  // ---------------- 公开排行榜 ----------------
  async function rankings() {
    const r = await API.rankings();
    const listItem = (b, i, cLabel) => `<div class="rank-item" data-id="${b.id}">
      <div class="rank-no ${i < 3 ? 'top' : ''}">${i + 1}</div>
      <div class="mini" style="background:${colorFor(b.title)}">${(b.title || '?').slice(0, 1)}</div>
      <div class="info"><h4>${b.title} <small class="muted">${b.author || ''}</small></h4><p>${b.category || ''}</p></div>
      <div class="rank-count">${b.c} <small>${cLabel}</small></div>
    </div>`;
    const readerItem = (u, i) => `<div class="rank-item">
      <div class="rank-no ${i < 3 ? 'top' : ''}">${i + 1}</div>
      <div class="mini" style="background:${colorFor(u.displayName)}">${u.displayName.slice(0, 1)}</div>
      <div class="info"><h4>${u.displayName} <small class="muted">${u.dept || ''}</small></h4></div>
      <div class="rank-count">${u.count} <small>本</small></div>
    </div>`;
    app().innerHTML = `<h2 style="margin-bottom:4px">📚 图书流动排行榜</h2>
      <p class="muted" style="font-size:13px;margin-bottom:16px">公开馆藏流动数据 · 隐私信息已匿名化</p>
      <div class="rank-grid">
        <div class="card"><div class="panel-title">🔥 最受欢迎 Top10</div><div id="rank-hot"></div></div>
        <div class="card"><div class="panel-title">🧊 冷门宝藏 Top10</div><div id="rank-cold"></div></div>
        <div class="card"><div class="panel-title">⭐ 借阅之星 Top10</div><div id="rank-readers"></div></div>
        <div class="card"><div class="panel-title">💬 好评榜 Top10</div><div id="rank-review"></div></div>
      </div>`;
    $('#rank-hot').innerHTML = (r.hot && r.hot.length) ? r.hot.map((b, i) => listItem(b, i, '次借阅')).join('') : '<div class="empty">暂无数据</div>';
    $('#rank-cold').innerHTML = (r.cold && r.cold.length) ? r.cold.map((b, i) => listItem(b, i, '次借阅')).join('') : '<div class="empty">暂无数据</div>';
    $('#rank-readers').innerHTML = (r.readers && r.readers.length) ? r.readers.map((u, i) => readerItem(u, i)).join('') : '<div class="empty">暂无数据</div>';
    $('#rank-review').innerHTML = (r.reviewTop && r.reviewTop.length) ? r.reviewTop.map((b, i) => `<div class="rank-item" data-id="${b.id}">
      <div class="rank-no ${i < 3 ? 'top' : ''}">${i + 1}</div>
      <div class="mini" style="background:${colorFor(b.title)}">${(b.title || '?').slice(0, 1)}</div>
      <div class="info"><h4>${b.title} <small class="muted">${b.author || ''}</small></h4><p>${b.category || ''}</p></div>
      <div class="rank-count">${b.avg} <small>分 · ${b.n}评</small></div>
    </div>`).join('') : '<div class="empty">暂无评论数据</div>';
    $$('.rank-item[data-id]').forEach(el => el.onclick = () => location.hash = '#/book/' + el.dataset.id);
  }

  // ---------------- 数字人文分析 ----------------
  async function dh() {
    const r = await API.dh();
    app().innerHTML = `<h2 style="margin-bottom:4px">🧭 数字人文分析</h2>
      <p class="muted" style="font-size:13px;margin-bottom:16px">用数字人文方法分析馆藏与借阅：分类热度 · 时间序列 · 标签云 · 读者-书籍网络</p>
      <div class="dh-grid">
        <div class="card"><div class="panel-title">分类借阅热度</div><canvas id="dh-cat" height="260"></canvas></div>
        <div class="card"><div class="panel-title">近 90 天借阅时间序列</div><canvas id="dh-ts" height="260"></canvas></div>
        <div class="card"><div class="panel-title">馆藏标签云</div><canvas id="dh-cloud" height="260"></canvas></div>
        <div class="card"><div class="panel-title">读者-书籍借阅网络（最近 80 条）</div><canvas id="dh-net" height="300"></canvas></div>
      </div>
      <div class="card" style="margin-top:18px"><div class="panel-title">高产学人 Top15</div>
        <div class="author-list" id="dh-authors"></div>
      </div>`;
    Charts.hbars($('#dh-cat'), (r.catHeat || []).map(c => ({ label: c.category, value: c.borrow_count })));
    Charts.timeseries($('#dh-ts'), r.trend90 || []);
    Charts.wordcloud($('#dh-cloud'), r.topTags || []);
    if ((r.network && r.network.nodes.length)) Charts.network($('#dh-net'), r.network);
    else $('#dh-net').parentElement.innerHTML += '<div class="empty" style="padding:20px">暂无网络数据</div>';
    $('#dh-authors').innerHTML = (r.authorTop || []).map(a => `<span class="pill">${a.author} <b>${a.c}</b></span>`).join('') || '<span class="muted">暂无数据</span>';
  }

  function kpi(k, v, color) {
    return `<div class="kpi"><div class="v" ${color ? `style="color:${color}"` : ''}>${v}</div><div class="k">${k}</div></div>`;
  }
  function $$(s, r = document) { return Array.from(r.querySelectorAll(s)); }
  function cleanupStars() { if (starScene) { starScene.destroy(); starScene = null; } }

  return { home, bookDetail, login, adminLogin, register, my, admin, adminCatalog, adminImport, adminReaders, adminLoans, screen, rankings, dh, cleanupStars };
})();
window.Views = Views;
