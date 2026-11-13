'use strict';
// 视图渲染层（原生 JS）· 数字人文平台版
// 版块：宇宙首页（3D 星系，2D 星空兜底）/ 书库 / 摘星辰 / 资讯 / 管理端
const Views = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const app = () => $('#app');

  // ==========================================================
  // 一、知识星空 2D 渲染器（3D 不可用时的兜底，算法保留）
  // ==========================================================
  const STAR_PALETTE = { '文学类': '#f0a23c', '艺术类': '#e070a0', '历史': '#3aa0a2', '思政综合类': '#b8892e', default: '#9a8cd0' };
  const FALLBACK_COLORS = ['#9a8cd0', '#7fa6e0', '#d08a8a', '#8ad0a0', '#d0c08a'];
  function colorForCat(cat) {
    if (cat && STAR_PALETTE[cat]) return STAR_PALETTE[cat];
    if (!cat) return STAR_PALETTE.default;
    let h = 0; for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) % FALLBACK_COLORS.length;
    return FALLBACK_COLORS[h];
  }

  function makeStarSprite(color) {
    const S = 64, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, color); grd.addColorStop(0.22, color);
    grd.addColorStop(0.45, hexA(color, 0.28)); grd.addColorStop(1, hexA(color, 0));
    g.fillStyle = grd; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.fill();
    const n = parseInt(color.slice(1), 16);
    const mix = c2 => Math.round(c2 + (255 - c2) * 0.55);
    g.fillStyle = `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
    g.beginPath(); g.arc(S / 2, S / 2, 7.5, 0, Math.PI * 2); g.fill();
    return c;
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  class StarScene {
    constructor(canvas, books, opts) {
      opts = opts || {};
      this.canvas = canvas;
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      this.stage = canvas.parentElement;
      this.all = books || [];
      this.max = this.all.length;
      this.seed = 0;
      this.nodes = [];
      this.links = [];
      this.micro = [];
      this.hoverId = null;
      this.encounterId = null;
      this.raf = null;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.t0 = performance.now();
      this.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.px = 0; this.py = 0; this.tgx = 0; this.tgy = 0;
      this.rot = 0; this.rotSpeed = 0.05; this._lastT = performance.now();
      this.sprites = {};
      Object.keys(STAR_PALETTE).forEach(k => { this.sprites[k] = makeStarSprite(STAR_PALETTE[k]); });
      this.tip = document.createElement('div');
      this.tip.className = 'star-tip';
      this.stage.appendChild(this.tip);
      this.applySky();
      this.resize();
      this.buildMicro();
      this.rebuild();
      this.bind();
      this.loop();
      this._ro = new ResizeObserver(() => {
        const w = this.w, h = this.h;
        this.resize();
        if (Math.abs(this.w - w) > 2 || Math.abs(this.h - h) > 2) { this.buildMicro(); this.rebuild(); }
      });
      this._ro.observe(this.stage);
      this._onTheme = () => this.applySky();
      window.addEventListener('dh:theme', this._onTheme);
    }
    resize() {
      const r = this.stage.getBoundingClientRect();
      const W = Math.min(4000, Math.max(320, r.width || 320));
      const H = Math.min(4000, Math.max(300, r.height || 300));
      this.w = W; this.h = H;
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
      const ctx = this.canvas.getContext('2d');
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.max = this.all.length;
      this.buildNebula();
    }
    applySky() {
      const dark = document.documentElement.dataset.theme === 'dark';
      this.skyLine = dark ? 'rgba(170,195,255,.16)' : 'rgba(255,222,196,.16)';
      this.microTint = dark ? '#dfe8ff' : '#eaf1ff';
      this.glowMode = dark ? 'lighter' : 'source-over';
    }
    buildMicro() {
      const cfg = [
        { count: 92, depth: 0.20, base: 0.45, size: 0.8, freq: 0.55 },
        { count: 64, depth: 0.42, base: 0.65, size: 1.05, freq: 1.05 },
        { count: 40, depth: 0.68, base: 0.9, size: 1.35, freq: 1.7 },
      ];
      const w = Math.max(1, Math.round(this.w)), h = Math.max(1, Math.round(this.h));
      this.micro = cfg.map(c => {
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const x = cv.getContext('2d');
        for (let i = 0; i < c.count; i++) {
          const px = Math.random() * w, py = Math.random() * h;
          const r = c.size * (0.55 + Math.random() * 0.85);
          x.globalAlpha = c.base * (0.35 + Math.random() * 0.65);
          x.fillStyle = Math.random() < 0.14 ? '#bcd2ff' : this.microTint;
          x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
        }
        return { canvas: cv, depth: c.depth, freq: c.freq, base: c.base };
      });
    }
    rebuild() { this.sample(); this.layout(); this.links = this.buildLinks(); this.grid = this.buildGrid(56); }
    sample() { this.picked = this.all.slice(); }
    reseed() { this.seed++; this.t0 = performance.now(); this.rebuild(); }
    buildNebula() {
      const w = Math.max(1, Math.round(this.w)), h = Math.max(1, Math.round(this.h));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const x = cv.getContext('2d');
      const pad = 26;
      const W = w - pad * 2, H = h - pad * 2;
      const cx = pad + W / 2, cy = pad + H / 2;
      const Rmax = Math.min(W, H) * 0.5;
      const flatten = H < W ? 0.74 : 0.86;
      const WIND = Math.PI * 1.5;
      const groups = new Map();
      (this.all || []).forEach(b => { const k = b.category || '其他'; groups.set(k, (groups.get(k) || 0) + 1); });
      const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1]);
      const N = sorted.length || 1;
      sorted.forEach(([key], k) => {
        const base = (k / N) * Math.PI * 2 + (N === 1 ? 0 : 0.2);
        const theta = base + WIND * 0.5;
        const cxp = cx + Math.cos(theta) * Rmax * 0.5;
        const cyp = cy + Math.sin(theta) * Rmax * 0.5 * flatten;
        const rad = Rmax * 0.96;
        const color = colorForCat(key);
        const g = x.createRadialGradient(cxp, cyp, 0, cxp, cyp, rad);
        g.addColorStop(0, hexA(color, 0.40));
        g.addColorStop(0.4, hexA(color, 0.15));
        g.addColorStop(1, hexA(color, 0));
        x.fillStyle = g; x.beginPath(); x.arc(cxp, cyp, rad, 0, Math.PI * 2); x.fill();
      });
      const core = x.createRadialGradient(cx, cy, 0, cx, cy, Rmax * 0.7);
      core.addColorStop(0, 'rgba(255,244,214,0.5)');
      core.addColorStop(0.35, 'rgba(255,228,180,0.18)');
      core.addColorStop(1, 'rgba(255,228,180,0)');
      x.fillStyle = core; x.beginPath(); x.arc(cx, cy, Rmax * 0.7, 0, Math.PI * 2); x.fill();
      this.nebula = cv;
    }
    layout() {
      const pad = 26;
      const W = this.w - pad * 2, H = this.h - pad * 2;
      const list = this.picked;
      if (!list.length) {
        this.nodes = Array.from({ length: 70 }, (_, k) => this.makeNode(null, pad + Math.random() * W, pad + Math.random() * H, k));
        this.relax(8, 16); return;
      }
      const groups = new Map();
      list.forEach(b => { const k = b.category || '其他'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); });
      const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
      const N = sorted.length;
      const cx = pad + W / 2, cy = pad + H / 2;
      const Rmax = Math.min(W, H) * 0.5;
      const flatten = H < W ? 0.74 : 0.86;
      const WIND = Math.PI * 1.5;
      this.nodes = [];
      sorted.forEach(([key, arr], k) => {
        const base = (k / N) * Math.PI * 2 + (N === 1 ? 0 : 0.2);
        arr.forEach((b, j) => {
          const t = (j + 0.5) / arr.length;
          const theta = base + t * WIND + (Math.random() - 0.5) * 0.55;
          const rr = Rmax * Math.pow(t, 0.62) * (0.9 + Math.random() * 0.2);
          const x = cx + Math.cos(theta) * rr;
          const y = cy + Math.sin(theta) * rr * flatten;
          const n = this.makeNode(b, x, y, this.nodes.length, key);
          n.armColor = colorForCat(key);
          if (!STAR_PALETTE[key]) n.colorKey = 'default';
          this.nodes.push(n);
        });
      });
      this.relax(6, 17);
    }
    makeNode(book, x, y, i, group) {
      const m = Math.pow(Math.random(), 2.2);
      return {
        id: book ? book.id : 'amb' + i, book: book, group: group || null,
        x: x, y: y,
        r: (book ? 1.3 : 1.1) + m * (book ? 2.8 : 1.4),
        mag: m,
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 1.4,
        phase2: Math.random() * Math.PI * 2,
        colorKey: (book && STAR_PALETTE[book.category]) ? book.category : 'default',
        delay: (i % 120) * 5.5 + Math.random() * 220,
        pulse: 0
      };
    }
    relax(iters, minD0) {
      const cell = 28, minD = minD0 || 18;
      for (let it = 0; it < iters; it++) {
        const g = new Map();
        const key = (cx, cy) => cx + ',' + cy;
        this.nodes.forEach((n, i) => { const k = key(Math.floor(n.x / cell), Math.floor(n.y / cell)); if (!g.has(k)) g.set(k, []); g.get(k).push(i); });
        for (let i = 0; i < this.nodes.length; i++) {
          const a = this.nodes[i];
          const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
          for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
            const bucket = g.get(key(cx + ox, cy + oy)); if (!bucket) continue;
            for (const j of bucket) {
              if (j <= i) continue;
              const b = this.nodes[j];
              let dx = b.x - a.x, dy = b.y - a.y;
              let d = Math.hypot(dx, dy);
              if (d >= minD) continue;
              if (d < 0.001) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d = Math.hypot(dx, dy) || 1; }
              const push = (minD - d) * 0.34;
              const ux = dx / d * push, uy = dy / d * push;
              a.x -= ux; a.y -= uy; b.x += ux; b.y += uy;
            }
          }
        }
        const pad = 8;
        this.nodes.forEach(n => {
          n.x = Math.min(this.w - pad, Math.max(pad, n.x));
          n.y = Math.min(this.h - pad, Math.max(pad, n.y));
        });
      }
    }
    buildLinks() {
      const byGroup = new Map();
      this.nodes.forEach((n, i) => { const k = n.group || 'amb'; if (!byGroup.has(k)) byGroup.set(k, []); byGroup.get(k).push(i); });
      const out = []; const capTotal = 52;
      byGroup.forEach(list => {
        if (list.length < 2) return;
        const sorted = list.slice().sort((a, b) => this.nodes[a].y - this.nodes[b].y);
        const per = Math.min(list.length - 1, Math.max(3, Math.round(list.length * 0.12)));
        for (let i = 0; i < per && out.length < capTotal; i++) out.push([sorted[i], sorted[i + 1]]);
      });
      return out;
    }
    buildGrid(cell) {
      const g = new Map();
      this.nodes.forEach((n, i) => { const k = Math.floor(n.x / cell) + ',' + Math.floor(n.y / cell); if (!g.has(k)) g.set(k, []); g.get(k).push(i); });
      return { cell, map: g };
    }
    pick(mx, my) {
      const { cell, map } = this.grid;
      mx -= this.px; my -= this.py;
      const cx = this.w / 2, cy = this.h / 2;
      const cos = Math.cos(this.rot), sin = Math.sin(this.rot);
      const dx = mx - cx, dy = my - cy;
      mx = cx + dx * cos + dy * sin;
      my = cy - dx * sin + dy * cos;
      let best = null, bd = Infinity;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const b = map.get((Math.floor(mx / cell) + ox) + ',' + (Math.floor(my / cell) + oy)); if (!b) continue;
        for (const i of b) {
          const n = this.nodes[i];
          const d = Math.hypot(n.x - mx, n.y - my);
          const hitR = Math.max(9, n.r * 2.2);
          if (d < hitR && d < bd) { bd = d; best = n; }
        }
      }
      return best;
    }
    bind() {
      const onMove = e => {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        if (!this.reduced) {
          this.tgx = ((mx - this.w / 2) / (this.w / 2)) * 22;
          this.tgy = ((my - this.h / 2) / (this.h / 2)) * 22;
        }
        const n = this.pick(mx, my);
        if (!n || !n.book) { this.setHover(null); return; }
        this.setHover(n);
      };
      this.canvas.addEventListener('mousemove', onMove);
      this.canvas.addEventListener('mouseleave', () => { this.tgx = 0; this.tgy = 0; this.setHover(null); });
      this.canvas.addEventListener('click', e => {
        const rect = this.canvas.getBoundingClientRect();
        const n = this.pick(e.clientX - rect.left, e.clientY - rect.top);
        if (n && n.book) location.hash = '#/book/' + n.id;
      });
    }
    setHover(n) {
      if (!n) { this.hoverId = null; this.tip.classList.remove('on'); this.canvas.style.cursor = 'default'; return; }
      if (this.hoverId === n.id) return;
      this.hoverId = n.id;
      this.canvas.style.cursor = 'pointer';
      const b = n.book;
      this.tip.innerHTML = `<b>${esc(b.title)}</b><div class="m">${esc(b.author || '未知')} · ${esc(b.category || '')}</div><div class="s">点击查看详情</div>`;
      const sx = n.x + this.px, sy = n.y + this.py;
      this.tip.style.left = Math.min(this.w - 100, Math.max(100, sx)) + 'px';
      const flip = sy < 92;
      this.tip.style.transform = flip ? 'translate(-50%,0) translateY(14px)' : 'translate(-50%,-100%) translateY(-14px)';
      this.tip.style.top = (flip ? sy + n.r * 2 + 6 : sy - n.r * 2 - 6) + 'px';
      this.tip.classList.add('on');
    }
    loop() {
      const ctx = this.canvas.getContext('2d');
      const now = performance.now();
      const t = now / 1000;
      if (!this.reduced) { this.px += (this.tgx - this.px) * 0.08; this.py += (this.tgy - this.py) * 0.08; }
      else { this.px = 0; this.py = 0; }
      if (!this.reduced) {
        const dt = Math.min(0.05, (now - this._lastT) / 1000);
        this.rot += this.rotSpeed * dt;
      }
      this._lastT = now;
      const cx = this.w / 2, cy = this.h / 2;
      const cos = Math.cos(this.rot), sin = Math.sin(this.rot);
      const rotY = (x, y) => { const dx = x - cx, dy = y - cy; return [cx + dx * cos - dy * sin + this.px, cy + dx * sin + dy * cos + this.py]; };
      ctx.clearRect(0, 0, this.w, this.h);
      if (this.nebula) {
        ctx.globalCompositeOperation = this.glowMode;
        ctx.globalAlpha = this.reduced ? 0.85 : 0.6 + 0.12 * Math.sin(t * 0.25);
        ctx.save();
        ctx.translate(cx, cy); ctx.rotate(this.rot);
        ctx.drawImage(this.nebula, -this.w / 2 + this.px * 0.5, -this.h / 2 + this.py * 0.5, this.w, this.h);
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      for (let li = 0; li < this.micro.length; li++) {
        const m = this.micro[li];
        const a = this.reduced ? m.base : m.base * (0.55 + 0.45 * Math.sin(t * m.freq + m.depth * 5));
        ctx.globalAlpha = Math.min(1, a);
        const ox = this.px * m.depth, oy = this.py * m.depth;
        ctx.drawImage(m.canvas, ox, oy, this.w, this.h);
      }
      ctx.globalAlpha = 1;
      if (this.links.length) {
        ctx.strokeStyle = this.skyLine; ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [i, j] of this.links) {
          const [ax, ay] = rotY(this.nodes[i].x, this.nodes[i].y);
          const [bx, by] = rotY(this.nodes[j].x, this.nodes[j].y);
          ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        }
        ctx.stroke();
      }
      for (let i = 0; i < this.nodes.length; i++) {
        const n = this.nodes[i];
        const grow = Math.min(1, Math.max(0, (now - this.t0 - n.delay) / 420));
        if (grow <= 0) continue;
        const ease = 1 - Math.pow(1 - grow, 3);
        const tw = this.reduced ? 0.9
          : 0.7 + 0.18 * Math.sin(t * n.speed + n.phase) + 0.12 * Math.sin(t * n.speed * 2.1 + n.phase2) + 0.04 * (1 - n.mag);
        const hover = this.hoverId === n.id;
        const pulse = n.pulse > 0 ? (1 - n.pulse) * 10 : 0;
        const r = (n.r + pulse) * (hover ? 1.7 : 1) * (0.4 + 0.6 * ease);
        const alpha = (n.book ? 0.95 : 0.42) * tw * ease;
        const [x, y] = rotY(n.x, n.y);
        const size = r * 8;
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.drawImage(this.sprites[n.colorKey], x - size / 2, y - size / 2, size, size);
        if (hover || this.encounterId === n.id) {
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = 'rgba(224,137,43,.9)'; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(x, y, r * 2.4 + 6, 0, Math.PI * 2); ctx.stroke();
        }
        if (n.pulse > 0) n.pulse = Math.max(0, n.pulse - 0.02);
      }
      ctx.globalAlpha = 1;
      this.raf = requestAnimationFrame(() => this.loop());
    }
    destroy() {
      if (this.raf) cancelAnimationFrame(this.raf);
      if (this._ro) this._ro.disconnect();
      if (this._onTheme) window.removeEventListener('dh:theme', this._onTheme);
      if (this.tip && this.tip.parentNode) this.tip.parentNode.removeChild(this.tip);
    }
  }

  // ==========================================================
  // 二、公共渲染块
  // ==========================================================
  function coverBlock(book) {
    if (book.cover) {
      return `<div class="cover"><img src="${assetUrl(book.cover)}" alt="" onerror="coverFallback(this)"></div>`;
    }
    if (book.call_no) {
      return `<div class="cover"><img src="${coverUrl(book.call_no)}" alt="" data-id="${book.id}" data-title="${esc(book.title)}" data-author="${esc(book.author)}" data-category="${esc(book.category)}" onerror="coverFallback(this)"></div>`;
    }
    return `<div class="cover"><div class="cover-art">${coverArtSVG(book)}</div></div>`;
  }
  function bookCard(b) {
    const tags = (b.tags || '').split(',').filter(Boolean).slice(0, 3)
      .map(t => `<span class="tag">${t}</span>`).join('');
    return `<div class="book-card" data-id="${b.id}">
      ${coverBlock(b)}
      <div class="book-body">
        <h3>${b.title}</h3>
        <div class="meta">${b.author || '未知'} · ${b.year || ''}</div>
        <div class="tagrow">${tags}</div>
      </div>
    </div>`;
  }
  // 星辰代号 → 星徽 SVG（作品封面占位）
  const CODE_COLORS = { '北极星': '#5a8dd6', '启明星': '#e8a53c', '织女星': '#b57ad0', '天狼星': '#d66a6a', '牵牛星': '#4aa8a0', '东壁星': '#c78a3e', default: '#8a7ad0' };
  function starBadge(code, size) {
    const c = CODE_COLORS[code] || CODE_COLORS.default;
    const s = size || 64;
    return `<svg viewBox="0 0 64 64" width="${s}" height="${s}" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="sb${esc(code)}"><stop offset="0" stop-color="#fff"/><stop offset="0.4" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity="0.1"/></radialGradient></defs>
      <circle cx="32" cy="32" r="30" fill="url(#sb${esc(code)})" stroke="${c}" stroke-width="1.5"/>
      <path d="M32 14 L36.5 27.5 L50 32 L36.5 36.5 L32 50 L27.5 36.5 L14 32 L27.5 27.5 Z" fill="#fff" opacity="0.92"/>
    </svg>`;
  }
  function workCoverBlock(w) {
    if (w.cover) return `<div class="work-cover"><img src="${assetUrl(w.cover)}" alt="" onerror="this.replaceWith(starBadgeEl('${esc(w.code)}'))"></div>`;
    return `<div class="work-cover"><div class="work-badge">${starBadge(w.code || '')}</div></div>`;
  }
  function starBadgeEl(code) { const d = document.createElement('div'); d.className = 'work-badge'; d.innerHTML = starBadge(code || ''); return d; }
  window.starBadgeEl = starBadgeEl;

  // 简易 Markdown 渲染（标题/粗体/斜体/列表/链接/段落）
  function mdRender(text) {
    const escMd = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = String(text || '').split('\n');
    let html = '', inList = false;
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (const raw of lines) {
      let line = raw;
      const inline = s => escMd(s)
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/\*([^*]+)\*/g, '<i>$1</i>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      const hm = line.match(/^(#{1,4})\s+(.*)/);
      if (hm) { closeList(); html += `<h${hm[1].length + 1}>${inline(hm[2])}</h${hm[1].length + 1}>`; continue; }
      const lm = line.match(/^\s*[-*]\s+(.*)/);
      if (lm) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(lm[1])}</li>`; continue; }
      closeList();
      if (line.trim() === '') { html += '<div class="md-gap"></div>'; continue; }
      html += `<p>${inline(line)}</p>`;
    }
    closeList();
    return html;
  }

  function fmtDate(d) { return (d || '').slice(0, 10); }

  // ==========================================================
  // 三、宇宙首页（3D 星系，降级 2D 星空）
  // ==========================================================
  let starScene = null;
  async function home() {
    const [cats, ov] = await Promise.all([API.categories().catch(() => []), API.overview().catch(() => ({}))]);
    app().innerHTML = `
      <section class="hero">
        <h1>数文拾光 <span class="g">数字人文宇宙</span></h1>
        <p>馆藏是星 · 作品是行星 · 资讯是星轨 —— 拖动旋转星系，点击星球进入版块</p>
        <div class="search-row">
          <input id="q" placeholder="搜索馆藏书名 / 作者 / 标签…" value="">
          <button class="btn" id="s-btn">检索书库</button>
        </div>
      </section>
      <section class="story" id="story">
        <div class="story-cards" id="story-cards"></div>
      </section>
      <div class="galaxy-wrap" id="galaxy-wrap">
        <div class="star-head">
          <div>
            <div class="star-title">🌌 数字人文宇宙</div>
            <div class="star-sub">书库旋臂 · 摘星辰行星 · 资讯星轨 · 点击星球直达</div>
          </div>
          <span class="star-count" id="star-count">—</span>
        </div>
        <div class="star-stage">
          <canvas id="star-canvas" class="star-canvas"></canvas>
          <div class="star-legend" id="star-legend"></div>
        </div>
        <div class="star-loader" id="star-loader"><span></span><span></span><span></span></div>
      </div>
      <section class="portal-grid" id="portal-grid">
        <a class="portal" href="#/library"><div class="p-icon">📚</div><b>书库</b><span>${ov.totalBooks || '—'} 本学院真实馆藏 · 检索与详情</span></a>
        <a class="portal" href="#/stars"><div class="p-icon">✨</div><b>摘星辰</b><span>${ov.worksCount || '—'} 件可视化作品 · ${ov.issues || '—'} 期实践</span></a>
        <a class="portal" href="#/news"><div class="p-icon">📰</div><b>资讯 · 专业</b><span>${ov.postsCount || '—'} 条动态 · 工具与学习资源</span></a>
      </section>`;
    const q = $('#q');
    const doSearch = () => { location.hash = '#/library' + (q.value.trim() ? ('?q=' + encodeURIComponent(q.value.trim())) : ''); };
    $('#s-btn').onclick = doSearch;
    q.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    // 数据故事卡
    const top = (ov.categories && ov.categories[0]) ? ov.categories[0] : null;
    $('#story-cards').innerHTML = [
      { k: '馆藏种数', v: ov.totalBooks, c: 'var(--accent)' },
      { k: '馆藏册数', v: ov.totalCopies, c: 'var(--ai)' },
      { k: '摘星辰作品', v: ov.worksCount, c: 'var(--cyan)' },
      { k: '实践期数', v: ov.issues, c: 'var(--amber)' },
      { k: '最大分类', v: top ? top.category : '—', c: 'var(--green)' }
    ].map(c => `<div class="story-card"><div class="v" ${c.c ? `style="color:${c.c}"` : ''}>${c.v == null ? '—' : c.v}</div><div class="k">${c.k}</div></div>`).join('');
    renderLegend(cats);
    // 3D 优先，降级 2D
    const loader = $('#star-loader');
    loader.classList.add('on');
    const stars = await API.stars({}).then(r => r.stars || []).catch(() => []);
    const count = $('#star-count');
    if (count) count.textContent = stars.length + ' 本馆藏';
    const canvas = $('#star-canvas');
    let ok3d = false;
    try {
      ok3d = await window.Galaxy.init(canvas, stars, { works: await API.works({}).then(r => r.works || []).catch(() => []) });
    } catch (e) { console.warn('[galaxy] 3D 初始化失败，回退 2D：', e); ok3d = false; }
    if (!ok3d) {
      if (starScene) starScene.destroy();
      starScene = new StarScene(canvas, stars);
    }
    loader.classList.remove('on');
  }
  function renderLegend(cats) {
    const box = $('#star-legend'); if (!box) return;
    const known = (cats || []).filter(c => c.category && STAR_PALETTE[c.category]);
    const items = known.length
      ? known.map(c => `<span><i class="dot" style="background:${colorForCat(c.category)}"></i>${esc(c.category)}</span>`).join('')
      : `<span><i class="dot" style="background:${STAR_PALETTE.default}"></i>馆藏</span>`;
    box.innerHTML = items + `<span><i class="dot" style="background:#e8a53c"></i>摘星辰作品</span><span>✨ 点击星球直达版块</span>`;
  }
  function cleanupStars() { if (starScene) { starScene.destroy(); starScene = null; } }

  // ==========================================================
  // 四、书库
  // ==========================================================
  let libState = { q: '', cat: '', page: 1 };
  async function library() {
    // 支持 #/library?q=xxx 检索入口
    const hm = (location.hash || '').match(/\?q=([^&]+)/);
    if (hm && hm[1]) { libState.q = decodeURIComponent(hm[1]); location.hash = '#/library'; }
    app().innerHTML = `
      <section class="hero">
        <h1>📚 <span class="g">书库</span></h1>
        <p>数字人文学院图书室真实馆藏 · 每本书都可查看详情与 AI 导读</p>
        <div class="search-row">
          <input id="q" placeholder="搜索书名 / 作者 / 标签 / 索书号…" value="${esc(libState.q)}">
          <button class="btn" id="s-btn">搜索</button>
        </div>
        <div class="chips" id="chips"><span class="chip ${!libState.cat ? 'active' : ''}" data-cat="">全部</span></div>
      </section>
      <div class="book-grid" id="book-grid"><div class="empty"><span class="spin"></span> 加载中…</div></div>
      <div class="pager" id="pager"></div>`;
    $('#s-btn').onclick = () => { libState.q = $('#q').value.trim(); libState.page = 1; loadLibrary(); };
    $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { libState.q = $('#q').value.trim(); libState.page = 1; loadLibrary(); } });
    $('#chips').addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      libState.cat = c.dataset.cat; libState.page = 1;
      $$('#chips .chip').forEach(x => x.classList.toggle('active', x === c));
      loadLibrary();
    });
    await loadLibrary();
  }
  async function loadLibrary() {
    const grid = $('#book-grid'); if (!grid) return;
    grid.innerHTML = '<div class="empty"><span class="spin"></span> 加载中…</div>';
    const r = await API.books({ q: libState.q, category: libState.cat, page: libState.page, pageSize: 24 });
    // 分类 chips 只在首次填充
    const chips = $('#chips');
    if (chips && chips.children.length <= 1) {
      chips.insertAdjacentHTML('beforeend', (r.categories || []).map(c =>
        `<span class="chip" data-cat="${esc(c)}">${esc(c)}</span>`).join(''));
    }
    grid.innerHTML = r.books.length ? r.books.map(bookCard).join('') : '<div class="empty" style="padding:30px">没有找到相关图书，换个关键词试试</div>';
    const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
    const pager = $('#pager');
    pager.innerHTML = pages > 1 ? `
      <button class="btn ghost sm" id="pg-prev" ${r.page <= 1 ? 'disabled' : ''}>← 上一页</button>
      <span class="muted">第 ${r.page} / ${pages} 页 · 共 ${r.total} 本</span>
      <button class="btn ghost sm" id="pg-next" ${r.page >= pages ? 'disabled' : ''}>下一页 →</button>` :
      `<span class="muted">共 ${r.total} 本</span>`;
    const prev = $('#pg-prev'), next = $('#pg-next');
    if (prev) prev.onclick = () => { libState.page--; loadLibrary(); window.scrollTo(0, 0); };
    if (next) next.onclick = () => { libState.page++; loadLibrary(); window.scrollTo(0, 0); };
  }

  // ==========================================================
  // 五、图书详情（去借阅，保留 AI 导读）
  // ==========================================================
  async function bookDetail(id) {
    const r = await API.book(id);
    const b = r.book;
    const tags = (b.tags || '').split(',').filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');
    app().innerHTML = `
      <a class="btn ghost sm" href="#/library">← 返回书库</a>
      <div class="detail" style="margin-top:14px">
        ${coverBlock(b)}
        <div>
          <h1>${b.title}</h1>
          <div class="line">作者：${b.author || '未知'}</div>
          <div class="line">出版：${b.publisher || '—'} ${b.year ? '· ' + b.year : ''}</div>
          <div class="line">分类：${b.category || '—'} ｜ 馆藏位置：${b.location || '—'}</div>
          <div class="line">索书号：${b.call_no || '—'} ｜ 定价：¥${b.price || '—'}</div>
          <div class="tagrow" style="margin:12px 0">${tags}</div>
          <div class="intro">${b.intro || '暂无简介。'}</div>
          <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
            ${window.STATIC_MODE ? '' : '<button class="btn ghost sm" id="digest-btn">✨ AI 导读</button>'}
          </div>
          <div id="digest-box" class="digest-box"></div>
        </div>
      </div>
      <div class="section-title">相关推荐</div>
      <div class="grid">${r.related.length ? r.related.map(bookCard).join('') : '<div class="empty">暂无相关图书</div>'}</div>`;
    const db2 = $('#digest-btn');
    if (db2) db2.onclick = async () => {
      const box = $('#digest-box'); db2.disabled = true; db2.textContent = '生成中…';
      try {
        const rd = await API.digest(b.id);
        const rel = (rd.books && rd.books.length)
          ? '<div class="digest-rel">延伸阅读：' + rd.books.map(x => `<a href="#/book/${x.id}">《${esc(x.title)}》</a>`).join('、') + '</div>'
          : '';
        box.innerHTML = `<div class="digest"><div class="digest-h">✨ AI 导读</div><div class="digest-body">${esc(rd.reply).replace(/\n/g, '<br>')}</div>${rel}</div>`;
        db2.textContent = '✨ 重新导读';
      } catch (e) { toast(e.message, 'err'); db2.textContent = '✨ AI 导读'; }
      db2.disabled = false;
    };
  }

  // ==========================================================
  // 六、摘星辰
  // ==========================================================
  async function starsView() {
    app().innerHTML = `
      <section class="hero">
        <h1>✨ <span class="g">摘星辰</span></h1>
        <p>危楼高百尺，手可摘星辰 —— 数文拾光协会周期性可视化实践计划，每期成果皆有一颗专属星辰</p>
      </section>
      <div id="stars-body"><div class="empty"><span class="spin"></span> 加载中…</div></div>`;
    const r = await API.works({});
    const works = r.works || [];
    const issues = r.issues || [];
    const body = $('#stars-body');
    if (!works.length) {
      body.innerHTML = '<div class="empty" style="padding:40px">第一期成果整理中，敬请期待 ✨<br><span class="muted">摘星辰计划：2026.10.26 — 12.12，每周一期</span></div>';
      return;
    }
    const byIssue = new Map();
    works.forEach(w => { if (!byIssue.has(w.issue_no)) byIssue.set(w.issue_no, []); byIssue.get(w.issue_no).push(w); });
    body.innerHTML = [...byIssue.entries()].map(([issue, list]) => `
      <div class="issue-block">
        <div class="issue-head">
          <div class="issue-no">第 ${issue} 期</div>
          <div class="issue-line"></div>
        </div>
        <div class="work-grid">
          ${list.map(w => `
            <div class="work-card" data-id="${w.id}">
              ${workCoverBlock(w)}
              <div class="work-body">
                <div class="work-code"><span class="star-chip" style="--cc:${CODE_COLORS[w.code] || CODE_COLORS.default}">${starBadge(w.code || '', 20)} ${esc(w.code || '未命名星')}</span></div>
                <h3>${esc(w.title)}</h3>
                <p class="work-summary">${esc((w.summary || '').slice(0, 80))}${(w.summary || '').length > 80 ? '…' : ''}</p>
                <div class="work-meta">
                  ${w.members ? `<span>👥 ${esc(w.members)}</span>` : ''}
                  <span>${fmtDate(w.published_at)}</span>
                </div>
              </div>
            </div>`).join('')}
        </div>
      </div>`).join('');
    $$('.work-card').forEach(c => c.onclick = () => location.hash = '#/work/' + c.dataset.id);
  }

  async function workDetail(id) {
    const r = await API.work(id);
    const w = r.work;
    const TYPE_LABEL = { html: '交互作品', image: '图像作品', video: '视频作品', link: '外部链接' };
    let body = '';
    if (w.type === 'html' && w.payload) {
      body = `<div class="work-frame-wrap"><iframe class="work-frame" src="${assetUrl(w.payload)}" sandbox="allow-scripts allow-popups" loading="lazy" title="${esc(w.title)}"></iframe></div>
        <p class="muted" style="font-size:12px;margin-top:8px">交互作品以沙箱模式嵌入运行 · 如无法交互可<a href="${assetUrl(w.payload)}" target="_blank" rel="noopener noreferrer">在新窗口打开</a></p>`;
    } else if (w.type === 'image' && w.payload) {
      body = `<div class="work-image"><img src="${assetUrl(w.payload)}" alt="${esc(w.title)}"></div>`;
    } else if (w.type === 'video' && w.payload) {
      body = `<div class="work-video"><video src="${assetUrl(w.payload)}" controls playsinline preload="metadata"></video></div>`;
    } else if (w.type === 'link' && w.payload) {
      body = `<div class="work-link-card"><p>本作品托管在外部平台</p><a class="btn" href="${esc(w.payload)}" target="_blank" rel="noopener noreferrer">🔗 打开作品</a></div>`;
    } else {
      body = `<div class="work-link-card"><p class="muted">作品文件整理中</p></div>`;
    }
    app().innerHTML = `
      <a class="btn ghost sm" href="#/stars">← 返回摘星辰</a>
      <div class="work-detail" style="margin-top:14px">
        <div class="work-detail-head">
          <div class="work-badge big">${starBadge(w.code || '', 84)}</div>
          <div>
            <h1>${esc(w.title)}</h1>
            <div class="work-detail-meta">
              <span class="star-chip" style="--cc:${CODE_COLORS[w.code] || CODE_COLORS.default}">${esc(w.code || '未命名星')}</span>
              <span class="status">${TYPE_LABEL[w.type] || w.type}</span>
              <span class="muted">第 ${w.issue_no} 期 · ${esc(w.org || '')}</span>
              ${w.members ? `<span class="muted">成员：${esc(w.members)}</span>` : ''}
            </div>
            ${w.tags ? '<div class="tagrow" style="margin-top:10px">' + w.tags.split(',').filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('') + '</div>' : ''}
          </div>
        </div>
        <div class="work-summary-full">${mdRender(w.summary || '暂无简介')}</div>
        ${body}
      </div>
      ${r.related.length ? `<div class="section-title">同期的其他星辰</div><div class="work-grid related">${r.related.map(x => `
        <div class="work-card" data-id="${x.id}">
          ${workCoverBlock(x)}
          <div class="work-body"><h3>${esc(x.title)}</h3><div class="work-meta"><span>${esc(x.code || '')}</span></div></div>
        </div>`).join('')}</div>` : ''}`;
    $$('.work-card').forEach(c => c.onclick = () => location.hash = '#/work/' + c.dataset.id);
  }

  // ==========================================================
  // 七、资讯 · 专业
  // ==========================================================
  let newsCat = '';
  async function news() {
    app().innerHTML = `
      <section class="hero">
        <h1>📰 <span class="g">资讯 · 专业</span></h1>
        <p>数字人文领域动态 · 前沿时事 · 实用工具 · 学习资源</p>
        <div class="chips" id="news-chips">
          ${['', '动态', '时事', '工具', '学习资源'].map(c =>
            `<span class="chip ${newsCat === c ? 'active' : ''}" data-cat="${c}">${c || '全部'}</span>`).join('')}
        </div>
      </section>
      <div id="news-list" class="news-list"><div class="empty"><span class="spin"></span> 加载中…</div></div>`;
    $('#news-chips').addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      newsCat = c.dataset.cat;
      $$('#news-chips .chip').forEach(x => x.classList.toggle('active', x === c));
      loadNews();
    });
    await loadNews();
  }
  async function loadNews() {
    const box = $('#news-list'); if (!box) return;
    const r = await API.posts(newsCat ? { category: newsCat } : {});
    const posts = r.posts || [];
    box.innerHTML = posts.length ? posts.map(p => `
      <a class="news-card" href="#/post/${p.id}">
        ${p.cover ? `<div class="news-cover"><img src="${assetUrl(p.cover)}" alt=""></div>` : `<div class="news-cover news-cover-ph">${esc((p.category || '资讯').slice(0, 2))}</div>`}
        <div class="news-body">
          <div class="news-meta"><span class="status">${esc(p.category || '资讯')}</span><span class="muted">${fmtDate(p.published_at)}</span></div>
          <h3>${esc(p.title)}</h3>
          <p class="muted">${esc(p.summary || '')}</p>
          ${p.source_name ? `<div class="news-src">来源：${esc(p.source_name)}</div>` : ''}
        </div>
      </a>`).join('') : '<div class="empty" style="padding:40px">该分类暂无内容</div>';
  }

  async function postDetail(id) {
    const r = await API.post(id);
    const p = r.post;
    app().innerHTML = `
      <a class="btn ghost sm" href="#/news">← 返回资讯</a>
      <article class="post-detail" style="margin-top:14px">
        <div class="news-meta" style="margin-bottom:10px">
          <span class="status">${esc(p.category || '资讯')}</span>
          <span class="muted">${fmtDate(p.published_at)}</span>
          ${p.source_name ? `<span class="muted">来源：${esc(p.source_name)}</span>` : ''}
        </div>
        <h1>${esc(p.title)}</h1>
        ${p.cover ? `<div class="post-cover"><img src="${assetUrl(p.cover)}" alt=""></div>` : ''}
        <div class="post-content">${mdRender(p.content || p.summary || '')}</div>
        ${p.source_url ? `<div class="post-src"><a class="btn" href="${esc(p.source_url)}" target="_blank" rel="noopener noreferrer">🔗 跳转浏览器查看原文${p.source_name ? '（' + esc(p.source_name) + '）' : ''}</a></div>` : ''}
      </article>`;
  }

  // ==========================================================
  // 八、管理端（创始人）
  // ==========================================================
  async function manage() {
    if (window.STATIC_MODE) {
      app().innerHTML = `<div class="card" style="max-width:460px;margin:40px auto;text-align:center">
        <h3 style="margin-bottom:6px">🔒 静态展示版</h3>
        <p class="muted" style="font-size:13px">当前为只读发布版本，内容管理请访问完整版平台。</p>
      </div>`;
      return;
    }
    if (!State.manageToken) return manageLogin();
    // 已有 token，先验证
    try { await API.manageWorks(); } catch (e) { State.clearManage(); return manageLogin(); }
    managePanels();
  }
  function manageLogin() {
    app().innerHTML = `<div class="card" style="max-width:420px;margin:40px auto">
      <h3 style="margin-bottom:6px">🔒 创始人管理端</h3>
      <p class="muted" style="font-size:13px;margin-bottom:16px">仅平台创始人可进入：管理摘星辰作品、资讯与发布静态版。</p>
      <div class="form">
        <label>管理口令</label>
        <input id="pass" type="password" placeholder="输入管理口令" autocomplete="current-password">
        <button class="btn" id="go">解锁</button>
      </div></div>`;
    const submit = async () => {
      try {
        const r = await API.manageLogin($('#pass').value);
        State.setManage(r.token);
        toast('已解锁管理端', 'ok');
        managePanels();
      } catch (e) { toast(e.message, 'err'); }
    };
    $('#go').onclick = submit;
    $('#pass').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }
  async function managePanels() {
    app().innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2>⚙️ 内容管理</h2>
        <button class="btn ghost sm" id="logout-manage">退出管理</button>
      </div>
      <div class="tabs">
        <span class="tab active" data-t="works">✨ 摘星辰作品</span>
        <span class="tab" data-t="posts">📰 资讯</span>
        <span class="tab" data-t="publish">🚀 发布静态版</span>
      </div>
      <div id="manage-body"><div class="empty"><span class="spin"></span> 加载中…</div></div>`;
    $('#logout-manage').onclick = () => { State.clearManage(); toast('已退出管理端', 'ok'); location.hash = '#/home'; };
    const render = (t) => {
      if (t === 'works') return manageWorksPanel();
      if (t === 'posts') return managePostsPanel();
      if (t === 'publish') return managePublishPanel();
    };
    $$('#app .tab').forEach(el => el.onclick = () => {
      $$('#app .tab').forEach(x => x.classList.toggle('active', x === el));
      render(el.dataset.t);
    });
    render('works');
  }

  // ---- 作品管理 ----
  async function manageWorksPanel() {
    const body = $('#manage-body');
    body.innerHTML = '<div class="empty"><span class="spin"></span> 加载中…</div>';
    const r = await API.manageWorks();
    const works = r.works || [];
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0 14px">
        <span class="muted" style="font-size:13px">共 ${works.length} 件作品</span>
        <button class="btn" id="add-work">+ 新增作品</button>
      </div>
      <div class="card" style="padding:0;overflow:auto"><table>
        <thead><tr><th>期</th><th>代号</th><th>标题</th><th>类型</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${works.map(w => `<tr>
          <td>第${w.issue_no}期</td>
          <td>${esc(w.code || '—')}</td>
          <td>${esc(w.title)}</td>
          <td>${w.type}</td>
          <td>${w.visible ? '✅ 展示中' : '🚫 隐藏'}</td>
          <td class="row-actions"><button class="btn ghost sm" data-edit="${w.id}">编辑</button>
            <button class="btn ghost sm" data-del="${w.id}">删除</button></td>
        </tr>`).join('') || '<tr><td colspan="6"><div class="empty">暂无作品</div></td></tr>'}</tbody></table></div>`;
    $('#add-work').onclick = () => workForm(null);
    $$('[data-edit]').forEach(b => b.onclick = () => workForm(works.find(w => String(w.id) === b.dataset.edit)));
    $$('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('确认删除该作品？')) return;
      try { await API.deleteWork(b.dataset.del); toast('已删除', 'ok'); manageWorksPanel(); } catch (e) { toast(e.message, 'err'); }
    });
  }
  function workForm(w) {
    const isEdit = !!w;
    openModal(`<h3>${isEdit ? '编辑作品' : '新增摘星辰作品'}</h3>
      <div class="form">
        <label>作品标题 *</label><input id="w-title" value="${esc(w ? w.title : '')}">
        <div class="form-row">
          <div><label>期数</label><input id="w-issue" type="number" min="1" value="${w ? w.issue_no : 1}"></div>
          <div><label>星辰代号</label><select id="w-code">${[''].concat(window.STAR_CODES || STAR_CODES).map(c =>
            `<option value="${c}" ${w && w.code === c ? 'selected' : ''}>${c || '（无）'}</option>`).join('')}</select></div>
        </div>
        <div class="form-row">
          <div><label>作品类型</label><select id="w-type">
            ${[['html', '交互 HTML'], ['image', '图片'], ['video', '视频'], ['link', '外部链接']].map(([v, t]) =>
              `<option value="${v}" ${w && w.type === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div><label>参与成员（逗号分隔）</label><input id="w-members" value="${esc(w ? w.members : '')}"></div>
        </div>
        <label>作品文件 / 链接（类型对应：上传 HTML/图片/视频文件，或粘贴外链）</label>
        <div class="upload-row">
          <input id="w-payload" value="${esc(w ? w.payload : '')}" placeholder="/media/... 或 https://...">
          <label class="btn ghost sm" style="display:inline-block;white-space:nowrap">上传文件<input id="w-file" type="file" hidden></label>
        </div>
        <div class="muted" id="w-file-hint" style="font-size:12px">图片 ≤8MB · 视频 ≤200MB · 其他 ≤50MB</div>
        <div class="form-row">
          <div><label>封面图（可空，自动生成星徽）</label>
            <div class="upload-row">
              <input id="w-cover" value="${esc(w ? w.cover : '')}" placeholder="/media/img/... 或留空">
              <label class="btn ghost sm" style="display:inline-block;white-space:nowrap">上传封面<input id="w-cover-file" type="file" accept="image/*" hidden></label>
            </div></div>
        </div>
        <label>简介</label><textarea id="w-summary" rows="4">${esc(w ? w.summary : '')}</textarea>
        <div class="form-row">
          <div><label>标签（逗号分隔）</label><input id="w-tags" value="${esc(w ? w.tags : '')}"></div>
          <div><label>主办单位</label><input id="w-org" value="${esc(w ? w.org : '数文拾光协会')}"></div>
        </div>
        <label style="display:flex;align-items:center;gap:8px"><input id="w-visible" type="checkbox" ${!w || w.visible ? 'checked' : ''}> 在平台展示</label>
        <button class="btn" id="w-save">保存</button>
      </div>`);
    $('#w-file').onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      const type = $('#w-type').value;
      const kind = type === 'video' ? 'video' : (type === 'image' ? 'img' : 'file');
      $('#w-file-hint').textContent = '上传中…';
      try {
        const r = await API.upload(file, kind);
        $('#w-payload').value = r.url;
        $('#w-file-hint').textContent = '✅ 已上传：' + r.url;
      } catch (err) { $('#w-file-hint').textContent = '❌ ' + err.message; }
    };
    $('#w-cover-file').onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const r = await API.upload(file, 'img');
        $('#w-cover').value = r.url;
        toast('封面上传成功', 'ok');
      } catch (err) { toast(err.message, 'err'); }
    };
    $('#w-save').onclick = async () => {
      const payload = {
        title: $('#w-title').value.trim(), issue_no: $('#w-issue').value, code: $('#w-code').value,
        type: $('#w-type').value, payload: $('#w-payload').value.trim(), cover: $('#w-cover').value.trim(),
        summary: $('#w-summary').value, members: $('#w-members').value, tags: $('#w-tags').value,
        org: $('#w-org').value, visible: $('#w-visible').checked
      };
      try {
        await API.saveWork(isEdit ? w.id : null, payload);
        closeModal(); toast('已保存', 'ok'); manageWorksPanel();
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  // ---- 资讯管理 ----
  async function managePostsPanel() {
    const body = $('#manage-body');
    body.innerHTML = '<div class="empty"><span class="spin"></span> 加载中…</div>';
    const r = await API.managePosts();
    const posts = r.posts || [];
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0 14px">
        <span class="muted" style="font-size:13px">共 ${posts.length} 条资讯</span>
        <button class="btn" id="add-post">+ 新增资讯</button>
      </div>
      <div class="card" style="padding:0;overflow:auto"><table>
        <thead><tr><th>分类</th><th>标题</th><th>外链</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${posts.map(p => `<tr>
          <td>${esc(p.category || '')}</td>
          <td>${esc(p.title)}</td>
          <td>${p.source_url ? '🔗' : '—'}</td>
          <td>${p.visible ? '✅ 展示中' : '🚫 隐藏'}</td>
          <td class="row-actions"><button class="btn ghost sm" data-edit="${p.id}">编辑</button>
            <button class="btn ghost sm" data-del="${p.id}">删除</button></td>
        </tr>`).join('') || '<tr><td colspan="5"><div class="empty">暂无资讯</div></td></tr>'}</tbody></table></div>`;
    $('#add-post').onclick = () => postForm(null);
    $$('[data-edit]').forEach(b => b.onclick = () => postForm(posts.find(p => String(p.id) === b.dataset.edit)));
    $$('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('确认删除该资讯？')) return;
      try { await API.deletePost(b.dataset.del); toast('已删除', 'ok'); managePostsPanel(); } catch (e) { toast(e.message, 'err'); }
    });
  }
  function postForm(p) {
    const isEdit = !!p;
    openModal(`<h3>${isEdit ? '编辑资讯' : '新增资讯'}</h3>
      <div class="form">
        <label>标题 *</label><input id="p-title" value="${esc(p ? p.title : '')}">
        <div class="form-row">
          <div><label>分类</label><select id="p-cat">${['动态', '时事', '工具', '学习资源'].map(c =>
            `<option ${p && p.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div><label>发布日期</label><input id="p-date" type="date" value="${p ? fmtDate(p.published_at) : new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <label>摘要</label><textarea id="p-summary" rows="2">${esc(p ? p.summary : '')}</textarea>
        <label>正文（支持 Markdown：## 标题 / **粗体** / - 列表 / [文字](网址)）</label>
        <textarea id="p-content" rows="8">${esc(p ? p.content : '')}</textarea>
        <div class="form-row">
          <div><label>来源名称</label><input id="p-srcname" value="${esc(p ? p.source_name : '')}"></div>
          <div><label>原文链接（点击跳转浏览器）</label><input id="p-srcurl" value="${esc(p ? p.source_url : '')}" placeholder="https://..."></div>
        </div>
        <label>封面图（可空）</label>
        <div class="upload-row">
          <input id="p-cover" value="${esc(p ? p.cover : '')}" placeholder="/media/img/... 或留空">
          <label class="btn ghost sm" style="display:inline-block;white-space:nowrap">上传封面<input id="p-cover-file" type="file" accept="image/*" hidden></label>
        </div>
        <label style="display:flex;align-items:center;gap:8px"><input id="p-visible" type="checkbox" ${!p || p.visible ? 'checked' : ''}> 在平台展示</label>
        <button class="btn" id="p-save">保存</button>
      </div>`);
    $('#p-cover-file').onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      try { const r = await API.upload(file, 'img'); $('#p-cover').value = r.url; toast('封面上传成功', 'ok'); }
      catch (err) { toast(err.message, 'err'); }
    };
    $('#p-save').onclick = async () => {
      const payload = {
        title: $('#p-title').value.trim(), category: $('#p-cat').value,
        summary: $('#p-summary').value, content: $('#p-content').value,
        source_name: $('#p-srcname').value, source_url: $('#p-srcurl').value.trim(),
        cover: $('#p-cover').value.trim(), visible: $('#p-visible').checked,
        published_at: $('#p-date').value || null
      };
      try {
        await API.savePost(isEdit ? p.id : null, payload);
        closeModal(); toast('已保存', 'ok'); managePostsPanel();
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  // ---- 发布静态版 ----
  function managePublishPanel() {
    $('#manage-body').innerHTML = `
      <div class="card" style="max-width:640px">
        <h3 style="margin-top:0">🚀 生成静态发布版</h3>
        <p class="muted" style="font-size:13px">把当前平台内容导出为纯静态只读网站（dist-static/ 目录），可上传到 GitHub Pages / Vercel 等免费托管，分享链接给同学浏览。</p>
        <ul class="muted" style="font-size:13px;line-height:1.9">
          <li>包含：全部页面 + 书库数据 + 摘星辰作品 + 资讯 + 封面与媒体文件（≤90MB）</li>
          <li>不包含：管理端、AI 服务（静态版隐藏 AI 入口）</li>
          <li>发布方式：把 <code>dist-static/</code> 内全部文件推送到 gh-pages 分支，或拖入 Vercel / Netlify</li>
        </ul>
        <button class="btn" id="pub-btn">开始导出</button>
        <div id="pub-result" class="muted" style="margin-top:12px;font-size:13px"></div>
      </div>`;
    $('#pub-btn').onclick = async () => {
      const btn = $('#pub-btn');
      btn.disabled = true; btn.textContent = '导出中，请稍候…';
      const box = $('#pub-result');
      box.textContent = '正在 checkpoint 数据库并拷贝资源…';
      try {
        const r = await API.publish();
        box.innerHTML = `<div class="digest"><div class="digest-h">✅ 导出完成</div><div class="digest-body">
          输出目录：<code>${esc(r.dir || 'dist-static/')}</code><br>
          文件数：${r.files != null ? r.files : '—'}<br>
          ${r.skippedMedia && r.skippedMedia.length ? '⚠️ 超限未打包的媒体（请改为外链）：<br>' + r.skippedMedia.map(m => '<code>' + esc(m) + '</code>').join('<br>') : '媒体文件全部包含 ✅'}
        </div></div>`;
      } catch (e) { box.textContent = '❌ ' + e.message; }
      btn.disabled = false; btn.textContent = '开始导出';
    };
  }

  function kpi(k, v, color) {
    return `<div class="kpi"><div class="v" ${color ? `style="color:${color}"` : ''}>${v}</div><div class="k">${k}</div></div>`;
  }

  return { home, library, bookDetail, starsView, workDetail, news, postDetail, manage, cleanupStars };
})();
window.Views = Views;
