'use strict';
// AI 助手悬浮窗：调用 /api/ai/ask，渲染回复与书目卡片
const AIWidget = (() => {
  const $ = s => document.querySelector(s);
  function colorFor(str) {
    let h = 0; for (let i = 0; i < (str || '?').length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return `linear-gradient(135deg,hsl(${h},70%,55%),hsl(${(h + 50) % 360},70%,45%))`;
  }
  function bookChip(b) {
    const ini = (b.title || '?').slice(0, 1);
    const cover = b.cover
      ? `<div class="c" style="background:#222 url('${b.cover}') center/cover"></div>`
      : `<div class="c" style="background:${colorFor(b.title)}">${ini}</div>`;
    return `<div class="b" data-id="${b.id}">${cover}<div><div>${b.title}</div><small>${b.author || ''} · ${b.category || ''}</small></div></div>`;
  }
  function addMsg(text, who, books) {
    const log = $('#ai-log');
    const el = document.createElement('div');
    el.className = 'msg ' + who;
    el.innerHTML = text.replace(/</g, '&lt;');
    if (books && books.length) {
      const box = document.createElement('div'); box.className = 'books';
      books.forEach(b => box.insertAdjacentHTML('beforeend', bookChip(b)));
      el.appendChild(box);
    }
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }
  async function send() {
    const inp = $('#ai-input'); const q = inp.value.trim(); if (!q) return;
    inp.value = ''; addMsg(q, 'me');
    const wait = document.createElement('div'); wait.className = 'msg ai'; wait.innerHTML = '<span class="spin"></span> 思考中…';
    $('#ai-log').appendChild(wait);
    try {
      const r = await API.ask(q);
      wait.remove();
      addMsg(r.reply || '（无回复）', 'ai', r.books || []);
    } catch (e) {
      wait.remove(); addMsg('出错了：' + (e.message || e), 'ai');
    }
  }
  async function welcome() {
    if ($('#ai-log').dataset.welcomed) return;
    $('#ai-log').dataset.welcomed = '1';
    let status = '离线规则引擎';
    try { const s = await API.aiStatus(); status = s.online ? '真实大模型在线' : '离线规则引擎'; } catch (e) {}
    const line = document.getElementById('ai-status-line');
    if (line) line.textContent = '当前模式：' + status;
    addMsg('你好，我是数智馆员小文，你的数字人文阅读伙伴。\n我可以帮你：\n• 在知识星空中荐书\n• 分析馆藏与借阅数据\n• 解答借阅规则\n• 为一本书生成 AI 导读', 'ai');
  }
  function toggle() {
    const p = $('#ai-panel');
    if (p.classList.contains('hidden')) { p.classList.remove('hidden'); welcome(); $('#ai-input').focus(); }
    else p.classList.add('hidden');
  }
  function init() {
    $('#ai-fab').addEventListener('click', toggle);
    $('#ai-close').addEventListener('click', () => $('#ai-panel').classList.add('hidden'));
    $('#ai-send').addEventListener('click', send);
    $('#ai-input').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    // 点击推荐书目卡片跳转详情
    $('#ai-log').addEventListener('click', e => {
      const b = e.target.closest('.b'); if (b) { location.hash = '#/book/' + b.dataset.id; $('#ai-panel').classList.add('hidden'); }
    });
  }
  return { init, toggle };
})();
window.AIWidget = AIWidget;
