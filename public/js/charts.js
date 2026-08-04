'use strict';
// 零依赖 Canvas 图表：折线（借阅趋势）、横向柱状（分类分布）、环形（借阅状态）
// 颜色运行时读取 CSS 变量，自动适配暖色主题
const Charts = (() => {
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  }
  function rgba(hex, a) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.parentElement.clientWidth || 320;
    const h = canvas.clientHeight || 220;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, w, h };
  }
  const grad = (ctx, x0, y0, x1, y1, c1, c2) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, c1); g.addColorStop(1, c2); return g;
  };

  function line(canvas, data) {
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    const accent = cssVar('--accent'), ai = cssVar('--ai'), line = cssVar('--line'), muted = cssVar('--muted');
    const padL = 34, padR = 12, padT = 14, padB = 26;
    const max = Math.max(1, ...data.map(d => d.count));
    const n = data.length;
    const x = i => padL + (w - padL - padR) * (n <= 1 ? 0.5 : i / (n - 1));
    const y = v => padT + (h - padT - padB) * (1 - v / max);
    ctx.strokeStyle = rgba(line.replace('#', '#'), 1); ctx.lineWidth = 1;
    ctx.strokeStyle = line.startsWith('#') ? rgba(line, .5) : line;
    for (let i = 0; i <= 3; i++) { const yy = padT + (h - padT - padB) * i / 3; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(x(0), y(data[0].count));
    data.forEach((d, i) => ctx.lineTo(x(i), y(d.count)));
    ctx.lineTo(x(n - 1), h - padB); ctx.lineTo(x(0), h - padB); ctx.closePath();
    ctx.fillStyle = grad(ctx, 0, padT, 0, h, rgba(accent, .35), rgba(accent, 0)); ctx.fill();
    ctx.beginPath(); data.forEach((d, i) => i ? ctx.lineTo(x(i), y(d.count)) : ctx.moveTo(x(i), y(d.count)));
    ctx.strokeStyle = accent; ctx.lineWidth = 2.5; ctx.shadowColor = rgba(accent, .5); ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
    ctx.fillStyle = ai;
    data.forEach((d, i) => { ctx.beginPath(); ctx.arc(x(i), y(d.count), 3, 0, 7); ctx.fill(); });
    ctx.fillStyle = muted; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    data.forEach((d, i) => { if (i % 2 === 0 || i === n - 1) ctx.fillText(d.date.slice(5), x(i), h - 8); });
  }

  function hbars(canvas, items) {
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    const ai = cssVar('--ai'), accent2 = cssVar('--accent2'), txt = cssVar('--txt'), line = cssVar('--line');
    const padL = 92, padR = 40, padT = 8;
    const max = Math.max(1, ...items.map(d => d.value));
    const rowH = (h - padT) / Math.max(1, items.length);
    ctx.font = '12px sans-serif'; ctx.textBaseline = 'middle';
    items.forEach((d, i) => {
      const yy = padT + rowH * i + rowH / 2;
      ctx.fillStyle = txt; ctx.textAlign = 'right';
      ctx.fillText(d.label, padL - 10, yy);
      const bw = (w - padL - padR) * (d.value / max);
      ctx.fillStyle = grad(ctx, padL, 0, padL + bw, 0, ai, accent2);
      roundRect(ctx, padL, yy - rowH * 0.3, Math.max(2, bw), rowH * 0.6, 6); ctx.fill();
      ctx.fillStyle = txt; ctx.textAlign = 'left'; ctx.font = 'bold 11px sans-serif';
      ctx.fillText(d.value, padL + Math.max(2, bw) + 8, yy);
      ctx.font = '12px sans-serif';
    });
  }

  function donut(canvas, items) {
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 14, ir = r * 0.62;
    const total = items.reduce((s, d) => s + d.value, 0) || 1;
    let a = -Math.PI / 2;
    items.forEach(d => {
      const ang = (d.value / total) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a + ang); ctx.closePath();
      ctx.fillStyle = d.color || cssVar('--accent'); ctx.fill();
      a += ang;
    });
    ctx.beginPath(); ctx.arc(cx, cy, ir, 0, 7); ctx.fillStyle = cssVar('--card-solid'); ctx.fill();
    ctx.fillStyle = cssVar('--txt'); ctx.textAlign = 'center'; ctx.font = 'bold 22px sans-serif';
    ctx.fillText(total, cx, cy - 4);
    ctx.fillStyle = cssVar('--muted'); ctx.font = '11px sans-serif'; ctx.fillText('累计借阅', cx, cy + 16);
    let ly = cy + r + 6;
    ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
    items.forEach(d => { ctx.fillStyle = d.color || cssVar('--accent'); ctx.fillRect(cx - 50, ly, 9, 9); ctx.fillStyle = cssVar('--txt'); ctx.fillText(`${d.label} ${d.value}`, cx - 36, ly + 8); ly += 16; });
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // 词云：items=[{tag,count}]
  function wordcloud(canvas, items) {
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    const colors = [cssVar('--accent'), cssVar('--ai'), cssVar('--accent2'), cssVar('--cyan'), cssVar('--green'), cssVar('--amber')];
    const max = Math.max(1, ...items.map(d => d.count));
    ctx.textBaseline = 'middle';
    const placed = [];
    items.forEach((d, i) => {
      const fs = 14 + (d.count / max) * 34;
      ctx.font = `${fs}px PingFang SC, Microsoft YaHei, sans-serif`;
      const tw = ctx.measureText(d.tag).width;
      let x = 0, y = 0, ok = false;
      for (let t = 0; t < 200; t++) {
        x = 10 + Math.random() * (w - tw - 20); y = 20 + Math.random() * (h - 40);
        const box = { x, y: y - fs / 2, w: tw + 8, h: fs + 6 };
        ok = !placed.some(p => !(box.x + box.w < p.x || box.x > p.x + p.w || box.y + box.h < p.y || box.y > p.y + p.h));
        if (ok) break;
      }
      placed.push({ x, y: y - fs / 2, w: tw + 8, h: fs + 6 });
      ctx.fillStyle = colors[i % colors.length];
      ctx.globalAlpha = 0.85;
      ctx.fillText(d.tag, x, y);
      ctx.globalAlpha = 1;
    });
  }

  // 力导向网络图：data={nodes:[{id,type,group}],links:[{source,target}]}
  function network(canvas, data) {
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    const nodes = data.nodes.map(n => ({ ...n, x: w / 2 + (Math.random() - 0.5) * w * 0.6, y: h / 2 + (Math.random() - 0.5) * h * 0.6, vx: 0, vy: 0 }));
    const nodeById = {}; nodes.forEach(n => nodeById[n.id] = n);
    const links = data.links.map(l => ({ s: nodeById[l.source], t: nodeById[l.target] })).filter(l => l.s && l.t);
    for (let k = 0; k < 120; k++) {
      // 斥力
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]; const dx = a.x - b.x, dy = a.y - b.y; const d = Math.hypot(dx, dy) || 1;
        const f = 1200 / (d * d); const ux = dx / d, uy = dy / d;
        a.vx += ux * f; a.vy += uy * f; b.vx -= ux * f; b.vy -= uy * f;
      }
      // 引力（连线）
      links.forEach(l => { const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y; const d = Math.hypot(dx, dy) || 1; const f = (d - 60) * 0.002; const ux = dx / d, uy = dy / d; l.s.vx += ux * f; l.s.vy += uy * f; l.t.vx -= ux * f; l.t.vy -= uy * f; });
      // 中心引力
      nodes.forEach(n => { n.vx += (w / 2 - n.x) * 0.001; n.vy += (h / 2 - n.y) * 0.001; n.x += n.vx; n.y += n.vy; n.vx *= 0.85; n.vy *= 0.85; });
    }
    // 绘制
    ctx.strokeStyle = rgba(cssVar('--line').replace('#', '#'), .5); ctx.lineWidth = 1;
    links.forEach(l => { ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y); ctx.stroke(); });
    nodes.forEach(n => {
      const r = n.type === 'book' ? 8 : 5;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7);
      ctx.fillStyle = n.type === 'book' ? cssVar('--ai') : cssVar('--cyan'); ctx.fill();
      ctx.fillStyle = cssVar('--txt'); ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      if (n.type === 'book') ctx.fillText(n.id.slice(1, 7) + (n.id.length > 8 ? '…' : ''), n.x, n.y + r + 12);
    });
  }

  // 时间序列：data=[{date,count}]
  function timeseries(canvas, data) {
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    const accent = cssVar('--accent'), ai = cssVar('--ai'), muted = cssVar('--muted');
    const padL = 34, padR = 12, padT = 14, padB = 26;
    const max = Math.max(1, ...data.map(d => d.count)); const n = data.length;
    const x = i => padL + (w - padL - padR) * (n <= 1 ? 0.5 : i / (n - 1));
    const y = v => padT + (h - padT - padB) * (1 - v / max);
    // 网格
    ctx.strokeStyle = rgba(cssVar('--line'), .4); ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const yy = padT + (h - padT - padB) * i / 3; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke(); }
    // 面积
    ctx.beginPath(); ctx.moveTo(x(0), y(data[0].count));
    data.forEach((d, i) => ctx.lineTo(x(i), y(d.count)));
    ctx.lineTo(x(n - 1), h - padB); ctx.lineTo(x(0), h - padB); ctx.closePath();
    ctx.fillStyle = grad(ctx, 0, padT, 0, h, rgba(accent, .25), rgba(accent, 0)); ctx.fill();
    // 线
    ctx.beginPath(); data.forEach((d, i) => i ? ctx.lineTo(x(i), y(d.count)) : ctx.moveTo(x(i), y(d.count)));
    ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke();
    // 点
    ctx.fillStyle = ai;
    data.forEach((d, i) => { if (d.count > 0) { ctx.beginPath(); ctx.arc(x(i), y(d.count), 2.5, 0, 7); ctx.fill(); } });
    // 日期
    ctx.fillStyle = muted; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    for (let i = 0; i < n; i += Math.ceil(n / 6)) ctx.fillText(data[i].date.slice(5), x(i), h - 8);
  }

  return { line, hbars, donut, wordcloud, network, timeseries };
})();
window.Charts = Charts;
