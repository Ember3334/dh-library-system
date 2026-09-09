'use strict';
// 视图渲染层（原生 JS）
const Views = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const app = () => $('#app');

  // ---------- 知识星空 Canvas 渲染器 ----------
  // 设计要点：
  // 1) 画布绝对定位于固定高度的 .star-stage，杜绝「canvas 撑高父容器 → 无限拉长」
  // 2) 采样上限 MAX 颗，避免 696 本一次性渲染卡死
  // 3) 按分类聚成「星系」，黄金角螺旋排布，视觉上像星座而不是一锅粥
  // 4) 排斥/连线/命中检测全部走网格，连线预计算，逐帧只做 drawImage（精灵图）
  // 四类馆藏各对应一条彩色旋臂的配色
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
    // 星核：向白色混合 55%（纯白核在浅色卡片背景上反而看不见）
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
      // 兜底：即便样式表未加载 / 出现 FOUC，也强制画布绝对定位铺满，
      // 彻底掐死「画布进入普通文档流 → 撑高父容器 → ResizeObserver 触发 → 尺寸越滚越大」的无限拉长反馈环
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      this.stage = canvas.parentElement;
      this.all = books || [];
      this.max = this.all.length; // 展示全部馆藏，不再采样
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
      // 视差：鼠标驱动的目标位置 + 平滑跟随
      this.px = 0; this.py = 0; this.tgx = 0; this.tgy = 0;
      // 整体缓旋（rad/s）：让星系缓慢绕中心自转，配合闪烁保持星空持续动态
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
      // 钳制到合理范围：即便出现任何尺寸反馈异常，也绝不会无限增长（上限 4000px）
      const W = Math.min(4000, Math.max(320, r.width || 320));
      const H = Math.min(4000, Math.max(300, r.height || 300));
      this.w = W; this.h = H;
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
      const ctx = this.canvas.getContext('2d');
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      // 展示全部馆藏；星云辉光随尺寸重建
      this.max = this.all.length;
      this.buildNebula();
    }
    // 主题色（仅影响连线等叠加层的对比度，天空底由 CSS 负责）
    applySky() {
      const dark = document.documentElement.dataset.theme === 'dark';
      this.skyLine = dark ? 'rgba(170,195,255,.16)' : 'rgba(255,222,196,.16)';
      this.microTint = dark ? '#dfe8ff' : '#eaf1ff';
      // 星云辉光的叠加模式：深色用 lighter 增亮，浅色用 source-over 着色（避免糊成白斑）
      this.glowMode = dark ? 'lighter' : 'source-over';
    }
    // 远景微星层（3 层离屏 canvas，逐帧各 1 次 drawImage，靠不同 alpha 频率错开明灭）
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
    // 采样：展示全部馆藏
    sample() { this.picked = this.all.slice(); }
    reseed() { this.seed++; this.t0 = performance.now(); this.rebuild(); }
    // 星云辉光：按分类在各自旋臂中段绘制一团彩色气体云 + 星系核心辉光（离屏预渲染，逐帧只 drawImage）
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
      // 星系核心辉光
      const core = x.createRadialGradient(cx, cy, 0, cx, cy, Rmax * 0.7);
      core.addColorStop(0, 'rgba(255,244,214,0.5)');
      core.addColorStop(0.35, 'rgba(255,228,180,0.18)');
      core.addColorStop(1, 'rgba(255,228,180,0)');
      x.fillStyle = core; x.beginPath(); x.arc(cx, cy, Rmax * 0.7, 0, Math.PI * 2); x.fill();
      this.nebula = cv;
    }
    // 布局：每类馆藏一条彩色旋臂（风车星系），中心汇聚成核，向外旋开
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
      // 星等幂律：多数暗星 + 少数亮星（真实星空分布）
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
    // 网格加速的排斥迭代
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
    // 连线预计算：稀疏星座骨架（每簇按 y 排序链状连接，总数封顶 ~52），避免逐帧 O(n²)
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
      // 鼠标坐标要反算视差：星在屏幕上位于 n.x + this.px，故用 mx - this.px 还原基础坐标
      mx -= this.px; my -= this.py;
      // 再反算整体旋转：把屏幕坐标逆旋回未旋转的基础坐标，否则旋转后命中会错位
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
      const ok = b.available > 0;
      this.tip.innerHTML = `<b>${esc(b.title)}</b><div class="m">${esc(b.author || '未知')} · ${esc(b.category || '')}</div>` +
        `<div class="s ${ok ? '' : 'no'}">${ok ? '可借 ' + b.available + ' / ' + b.total : '已借出完'}</div>`;
      // 浮层跟随视差后的屏幕坐标
      const sx = n.x + this.px, sy = n.y + this.py;
      this.tip.style.left = Math.min(this.w - 100, Math.max(100, sx)) + 'px';
      const flip = sy < 92;
      this.tip.style.transform = flip ? 'translate(-50%,0) translateY(14px)' : 'translate(-50%,-100%) translateY(-14px)';
      this.tip.style.top = (flip ? sy + n.r * 2 + 6 : sy - n.r * 2 - 6) + 'px';
      this.tip.classList.add('on');
    }
    encounter() {
      const live = this.nodes.filter(n => n.book);
      if (!live.length) return;
      const s = live[Math.floor(Math.random() * live.length)];
      this.encounterId = s.id; s.pulse = 1;
      setTimeout(() => { location.hash = '#/book/' + s.id; this.encounterId = null; s.pulse = 0; }, 900);
    }
    loop() {
      const ctx = this.canvas.getContext('2d');
      const now = performance.now();
      const t = now / 1000;
      // 视差平滑跟随
      if (!this.reduced) { this.px += (this.tgx - this.px) * 0.08; this.py += (this.tgy - this.py) * 0.08; }
      else { this.px = 0; this.py = 0; }
      // 整体缓旋：帧率无关地推进，让星系绕中心自转
      if (!this.reduced) {
        const dt = Math.min(0.05, (now - this._lastT) / 1000);
        this.rot += this.rotSpeed * dt;
      }
      this._lastT = now;
      const cx = this.w / 2, cy = this.h / 2;
      const cos = Math.cos(this.rot), sin = Math.sin(this.rot);
      // 绕中心旋转后叠加视差：返回屏幕坐标
      const rotY = (x, y) => { const dx = x - cx, dy = y - cy; return [cx + dx * cos - dy * sin + this.px, cy + dx * sin + dy * cos + this.py]; };
      ctx.clearRect(0, 0, this.w, this.h);
      // 星云辉光（按主题叠加模式：深色 lighter 增亮，浅色 source-over 着色）；随星系一起旋转、并按视差轻微错位
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
      // 远景微星层（3 层，按视差深度错位 + 不同频率明灭）
      for (let li = 0; li < this.micro.length; li++) {
        const m = this.micro[li];
        const a = this.reduced ? m.base : m.base * (0.55 + 0.45 * Math.sin(t * m.freq + m.depth * 5));
        ctx.globalAlpha = Math.min(1, a);
        const ox = this.px * m.depth, oy = this.py * m.depth;
        ctx.drawImage(m.canvas, ox, oy, this.w, this.h);
      }
      ctx.globalAlpha = 1;
      // 星座连线（稀疏骨架，随书籍星层一起视差与旋转）
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
      // 书籍星：精灵图 drawImage；双正弦闪烁（暗星振幅更大），浅色/深色均用 source-over（lighter 会糊成白斑）
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
        const baseAlpha = n.book ? (n.book.available > 0 ? 0.95 : 0.4) : 0.42;
        const alpha = baseAlpha * tw * ease;
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
          <button class="btn ghost" id="encounter-btn">🎴 星辰奇遇 · 抽卡</button>
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
        <div class="star-head">
          <div>
            <div class="star-title">✨ 知识星空</div>
            <div class="star-sub">${f.cat ? '当前分类：' + esc(f.cat) : '每类书是一条彩色旋臂 · 点击星星查看图书 · 悬停显示书名'}</div>
          </div>
          <span class="star-count" id="star-count">—</span>
          <button class="star-reseed" id="star-reseed" title="重新生成星图排布">✨ 焕新星图</button>
        </div>
          <div class="star-stage">
            <canvas id="star-canvas" class="star-canvas"></canvas>
            <div class="star-sample" id="star-sample" style="display:none"></div>
            <div class="star-legend" id="star-legend"></div>
          </div>
        <div class="star-loader" id="star-loader"><span></span><span></span><span></span></div>
      </div>
      <section class="cat-books" id="cat-books" style="display:none">
        <div class="section-head">
          <h3 id="cat-title">分类精选</h3>
          <a class="btn ghost sm" href="#/books" id="cat-more">查看全部 →</a>
        </div>
        <div class="book-grid" id="cat-grid"></div>
      </section>`;
    $('#encounter-btn').addEventListener('click', () => openDraw());
    $('#q').addEventListener('input', e => { f.q = e.target.value; loadStars(); });
    $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') loadStars(); });
    $('#s-btn').addEventListener('click', loadStars);
    $('#chips').addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      f.cat = c.dataset.cat;
      $$('#chips .chip').forEach(x => x.classList.toggle('active', x === c));
      loadStars();
    });
    renderLegend(cats);
    loadStory();
    startTicker();
    await loadStars();
  }
  async function loadStars() {
    const wrap = $('.star-wrap'); if (!wrap) return;
    wrap.classList.add('loading');
    try {
      const [r, booksResp] = await Promise.all([
        API.stars({ q: f.q, category: f.cat }),
        API.books({ category: f.cat, limit: 8 })
      ]);
      const stars = (r && r.stars) || [];
      const canvas = $('#star-canvas');
      if (starScene) starScene.destroy();
      starScene = new StarScene(canvas, stars);
      const count = $('#star-count'); if (count) count.textContent = (f.cat ? '' : '全部 ') + stars.length + ' 本';
      renderStarSample(stars.length);
      const rb = $('#star-reseed'); if (rb) rb.onclick = () => { if (starScene) starScene.reseed(); };
      renderCatBooks((booksResp && booksResp.books) || [], f.cat);
    } catch (e) {
      console.warn('[stars] 加载失败，启用环境星兜底', e);
      const canvas = $('#star-canvas');
      if (starScene) starScene.destroy();
      starScene = new StarScene(canvas, []);
      const count = $('#star-count'); if (count) count.textContent = '—';
      renderStarSample(0);
      renderCatBooks([], f.cat);
    } finally {
      wrap.classList.remove('loading');
    }
  }
  // 采样提示：全部展示后不再提示过饱和；保留「焕新星图」入口（见 star-head 按钮）
  function renderStarSample(total) {
    const box = $('#star-sample'); if (!box) return;
    box.style.display = 'none'; box.innerHTML = '';
  }
  // 图例：按分类色块 + 可借/已借完状态
  function renderLegend(cats) {
    const box = $('#star-legend'); if (!box) return;
    const known = (cats || []).filter(c => c.category && STAR_PALETTE[c.category]);
    const items = known.length
      ? known.map(c => `<span><i class="dot" style="background:${colorForCat(c.category)}"></i>${esc(c.category)}</span>`).join('')
      : `<span><i class="dot" style="background:${STAR_PALETTE.default}"></i>馆藏</span>`;
    box.innerHTML = items + `<span><i class="dot lit"></i>可借</span><span><i class="dot dim"></i>已借完</span><span>✨ 点击星星查看图书</span>`;
  }
  function fillGrid(grid, list) {
    grid.innerHTML = list.map(b => bookCard(b)).join('');
    grid.querySelectorAll('.book-card').forEach((c, i) => {
      c.style.opacity = '0'; c.style.transform = 'translateY(16px)';
      setTimeout(() => { c.style.transition = 'opacity .35s, transform .35s'; c.style.opacity = '1'; c.style.transform = 'translateY(0)'; }, i * 40);
    });
    grid.querySelectorAll('.book-card').forEach(c => c.onclick = () => location.hash = '#/book/' + c.dataset.id);
  }
  function renderCatBooks(books, cat) {
    const sec = $('#cat-books'); const grid = $('#cat-grid'); const title = $('#cat-title'); const more = $('#cat-more');
    if (!sec) return;
    const list = books || [];
    if (list.length) {
      sec.style.display = 'block';
      if (title) title.textContent = cat ? (cat + ' · 精选') : '✨ 精选推荐';
      if (more) more.href = cat ? ('#/books?category=' + encodeURIComponent(cat)) : '#/books';
      fillGrid(grid, list);
      return;
    }
    // 无数据：未选分类时回退拉取「精选推荐」，确保页面不空、有关联感
    if (!cat) {
      API.books({ limit: 8 }).then(rec => {
        const b = (rec && rec.books) || [];
        if (!b.length) { sec.style.display = 'none'; return; }
        sec.style.display = 'block';
        if (title) title.textContent = '✨ 精选推荐';
        if (more) more.href = '#/books';
        fillGrid(grid, b);
      }).catch(() => { sec.style.display = 'none'; });
      return;
    }
    sec.style.display = 'none';
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
      const p = $('#ai-pill');
      if (p) {
        p.textContent = 'AI · ' + (s.online ? '真实模型在线' : `离线智能体 ${(s.tools || []).length} 工具`);
        p.className = 'ai-pill ' + (s.online ? 'on' : 'off');
        p.title = (s.intents || []).length + ' 类意图 / ' + (s.tools || []).join('、');
      }
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
    const listItem = (b, i, cVal, cLabel) => `<div class="rank-item" data-id="${b.id}">
      <div class="rank-no ${i < 3 ? 'top' : ''}">${i + 1}</div>
      <div class="mini" style="background:${colorFor(b.title)}">${(b.title || '?').slice(0, 1)}</div>
      <div class="info"><h4>${b.title} <small class="muted">${b.author || ''}</small></h4><p>${b.category || ''}</p></div>
      <div class="rank-count">${cVal} <small>${cLabel}</small></div>
    </div>`;
    const readerItem = (u, i) => `<div class="rank-item">
      <div class="rank-no ${i < 3 ? 'top' : ''}">${i + 1}</div>
      <div class="mini" style="background:${colorFor(u.displayName)}">${u.displayName.slice(0, 1)}</div>
      <div class="info"><h4>${u.displayName} <small class="muted">${u.dept || ''}</small></h4></div>
      <div class="rank-count">${u.count} <small>本</small></div>
    </div>`;
    const demoNote = r.demo ? `<div class="demo-note">📌 本页含 <b>10 位虚拟读者</b> 的演示数据，仅用于作品展示，非真实借阅记录</div>` : '';
    app().innerHTML = `<h2 style="margin-bottom:4px">📚 图书流动排行榜</h2>
      <p class="muted" style="font-size:13px;margin-bottom:16px">公开馆藏流动数据 · 隐私信息已匿名化</p>
      ${demoNote}
      <div class="rank-grid">
        <div class="card"><div class="panel-title">🔥 最受欢迎 Top10</div><div id="rank-hot"></div></div>
        <div class="card"><div class="panel-title">🧊 冷门宝藏 Top10</div><div id="rank-cold"></div></div>
        <div class="card"><div class="panel-title">⭐ 借阅之星 Top10</div><div id="rank-readers"></div></div>
        <div class="card"><div class="panel-title">💬 好评榜 Top10</div><div id="rank-review"></div></div>
      </div>`;
    $('#rank-hot').innerHTML = (r.hot && r.hot.length) ? r.hot.map((b, i) => listItem(b, i, b.c, '次借阅')).join('') : '<div class="empty">暂无数据</div>';
    $('#rank-cold').innerHTML = (r.cold && r.cold.length) ? r.cold.map((b, i) => listItem(b, i, b.c, '次借阅')).join('') : '<div class="empty">暂无数据</div>';
    $('#rank-readers').innerHTML = (r.readers && r.readers.length) ? r.readers.map((u, i) => readerItem(u, i)).join('') : '<div class="empty">暂无数据</div>';
    $('#rank-review').innerHTML = (r.reviewTop && r.reviewTop.length) ? r.reviewTop.map((b, i) => listItem(b, i, b.avg, '分 · ' + b.n + '评')).join('') : '<div class="empty">暂无评论数据</div>';
    $$('.rank-item[data-id]').forEach(el => el.onclick = () => location.hash = '#/book/' + el.dataset.id);
  }

  // ---------------- 数字人文分析 ----------------
  async function dh() {
    const r = await API.dh();
    const demoNote = r.demo ? `<div class="demo-note">📌 本页含 <b>10 位虚拟读者</b> 的演示数据，仅用于作品展示，非真实借阅记录</div>` : '';
    app().innerHTML = `<h2 style="margin-bottom:4px">🧭 数字人文分析</h2>
      <p class="muted" style="font-size:13px;margin-bottom:16px">用数字人文方法分析馆藏与借阅：分类热度 · 时间序列 · 标签云 · 读者-书籍网络</p>
      ${demoNote}
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
  // ---------------- 星辰奇遇 · 抽卡 ----------------
  function dCover(b) {
    const attrs = `data-id="${b.id}" data-title="${esc(b.title)}" data-author="${esc(b.author)}" data-category="${esc(b.category)}"`;
    if (b.cover) return `<img src="${esc(b.cover)}" alt="" ${attrs} onerror="dCvFallback(this)">`;
    if (b.call_no) return `<img src="${coverUrl(b.call_no)}" alt="" ${attrs} onerror="dCvFallback(this)">`;
    return `<div class="cx" style="background:${colorForCat(b.category)}">${esc((b.title || '?').slice(0, 1))}</div>`;
  }
  // 复用全局 coverFallback 生成与全站一致的艺术书封；无则兜底为书名占位
  window.dCvFallback = img => {
    if (window.coverFallback) window.coverFallback(img);
    else img.parentNode.innerHTML = '<div class="cx">📖</div>';
  };
  function gachaPool() {
    if (starScene && starScene.nodes) {
      const arr = starScene.nodes.filter(n => n.book).map(n => n.book);
      if (arr.length) return arr;
    }
    return [];
  }
  function openDraw() { renderDraw(gachaPool()); }
  function renderDraw(pool) {
    let mask = $('#draw-mask');
    if (!mask) { mask = document.createElement('div'); mask.id = 'draw-mask'; document.body.appendChild(mask); }
    mask.innerHTML = `<div id="draw-card">
      <h3>🎴 星辰奇遇</h3>
      <div class="d-sub">从浩瀚知识星海随机抽取一本好书</div>
      <div class="d-reveal" id="d-reveal"><div class="d-inner">
        <div class="d-face d-back" id="d-back"><div class="star">✦</div><div class="dback-txt">点击翻牌 · 遇见奇遇</div></div>
        <div class="d-face d-front" id="d-front"></div>
      </div></div>
      <div class="d-actions">
        <button class="btn ghost" id="d-again">再抽一张</button>
        <button class="btn" id="d-view">查看详情</button>
        <button class="btn ghost sm" id="d-close">关闭</button>
      </div></div>`;
    mask.classList.remove('hidden');
    const reveal = $('#d-reveal'), front = $('#d-front');
    let cur = null;
    const pick = () => {
      const b = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
      front.innerHTML = b ? (
        `<div class="dc-img">${dCover(b)}</div>
        <div class="dc-body">
          <h4>${esc(b.title)}</h4>
          <div class="m">${esc(b.author || '未知')}${b.category ? ' · ' + esc(b.category) : ''}${b.call_no ? ' · ' + esc(b.call_no) : ''}</div>
          <span class="st ${b.available > 0 ? 'ok' : 'no'}">${b.available > 0 ? '可借 ' + b.available + ' 本' : '已借完'}</span>
        </div>`
      ) : `<div class="dc-img"><div class="cx" style="color:rgba(255,255,255,.8)">🌌</div></div><div class="dc-body"><h4>暂无馆藏</h4><div class="m">换个星区再试试</div></div>`;
      return b;
    };
    cur = pick();
    reveal.classList.remove('flip');
    $('#d-back').addEventListener('click', () => { if (!reveal.classList.contains('flip')) reveal.classList.add('flip'); });
    $('#d-again').onclick = () => { cur = pick(); reveal.classList.remove('flip'); setTimeout(() => reveal.classList.add('flip'), 40); };
    $('#d-view').onclick = () => { if (cur && cur.id) { location.hash = '#/book/' + cur.id; closeDraw(); } };
    $('#d-close').onclick = closeDraw;
    mask.addEventListener('click', e => { if (e.target === mask) closeDraw(); });
  }
  function closeDraw() { const m = $('#draw-mask'); if (m) m.classList.add('hidden'); }
  function cleanupStars() { if (starScene) { starScene.destroy(); starScene = null; } }

  return { home, bookDetail, login, adminLogin, register, my, admin, adminCatalog, adminImport, adminReaders, adminLoans, screen, rankings, dh, cleanupStars, openDraw };
})();
window.Views = Views;
