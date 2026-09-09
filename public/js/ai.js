'use strict';
// AI 馆员智能体前端：结构化回复（书目卡片 + 快捷追问 + 意图徽标）
const AIWidget = (() => {
  const $ = s => document.querySelector(s);
  let busy = false;

  function colorFor(str) {
    let h = 0; for (let i = 0; i < (str || '?').length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return `linear-gradient(135deg,hsl(${h},70%,55%),hsl(${(h + 50) % 360},70%,45%))`;
  }
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // 轻量 Markdown：**加粗** / 换行 / 项目符号
  function fmtText(t) {
    return esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\n/g, '<br>')
      .replace(/(^|<br>)\s*[·•]\s*/g, '$1• ');
  }
  const INTENT_LABEL = {
    search: '检索', recommend: '荐书', similar: '相似书', digest: '导读', opinion: '口碑',
    availability: '库存', stats: '统计', hot: '热门', category: '分类', my_borrows: '我的借阅',
    overdue: '逾期', rule: '规则', more: '换一批', fallback: '未命中', greeting: '问候',
    who: '能力介绍', thanks: '致谢', borrow: '借书', return_book: '还书'
  };
  function coverHTML(b) {
    if (b.cover) return `<img class="c" src="${esc(b.cover)}" alt="" onerror="this.style.visibility='hidden'">`;
    if (b.call_no) return `<img class="c" src="${coverUrl(b.call_no)}" alt="" onerror="this.style.visibility='hidden'">`;
    return `<div class="c" style="background:${colorFor(b.title)}">${esc((b.title || '?').slice(0, 1))}</div>`;
  }
  function bookChip(b) {
    const ok = (b.available || 0) > 0;
    return `<div class="b" data-id="${b.id}">
      ${coverHTML(b)}
      <div class="bi">
        <div class="bt">${esc(b.title)}</div>
        <small>${esc(b.author || '未知')}${b.category ? ' · ' + esc(b.category) : ''}${b.call_no ? ' · ' + esc(b.call_no) : ''}</small>
      </div>
      <span class="st ${ok ? 'ok' : 'no'}">${ok ? '可借' : '借完'}</span>
    </div>`;
  }
  function scrollDown() { const log = $('#ai-log'); log.scrollTop = log.scrollHeight; }

  function addMsg(text, who, books, chips, intent) {
    const log = $('#ai-log');
    const el = document.createElement('div');
    el.className = 'msg ' + who;
    let html = fmtText(text);
    if (who === 'ai' && intent) html += `<span class="ai-intent">${esc(INTENT_LABEL[intent] || intent)}</span>`;
    el.innerHTML = html;
    if (books && books.length) {
      const box = document.createElement('div'); box.className = 'books';
      box.innerHTML = books.slice(0, 8).map(bookChip).join('');
      el.appendChild(box);
    }
    if (chips && chips.length && who === 'ai') {
      const c = document.createElement('div'); c.className = 'ai-chips';
      c.innerHTML = chips.slice(0, 4).map(x => `<button class="ai-chip"${x === '查看我的借阅' ? ' data-go="#/my"' : ''}>${esc(x)}</button>`).join('');
      el.appendChild(c);
    }
    log.appendChild(el);
    scrollDown();
    return el;
  }
  function typing() {
    const el = document.createElement('div');
    el.className = 'msg ai';
    el.innerHTML = '<span class="spin"></span> 小文正在检索馆藏…';
    $('#ai-log').appendChild(el); scrollDown();
    return el;
  }

  async function send(text) {
    const inp = $('#ai-input');
    const q = (text !== undefined ? text : inp.value).trim();
    if (!q || busy) return;
    inp.value = '';
    addMsg(q, 'me');
    busy = true;
    $('#ai-send').disabled = true;
    const wait = typing();
    try {
      const r = await API.ask(q);
      wait.remove();
      addMsg(r.reply || '（无回复）', 'ai', r.books || [], r.chips || [], r.intent);
    } catch (e) {
      wait.remove();
      addMsg('出错了：' + (e.message || e), 'ai', [], ['推荐几本书', '馆藏统计']);
    } finally {
      busy = false;
      $('#ai-send').disabled = false;
      scrollDown();
    }
  }

  async function welcome() {
    if ($('#ai-log').dataset.welcomed) return;
    $('#ai-log').dataset.welcomed = '1';
    let s = null;
    try { s = await API.aiStatus(); } catch (e) {}
    const line = $('#ai-status-line');
    if (line && s) {
      line.textContent = s.online
        ? '真实大模型在线 · ' + (s.model || '')
        : `离线智能体 · ${(s.intents || []).length} 类意图 / ${(s.tools || []).length} 个工具`;
    }
    addMsg('你好，我是数智馆员小文 🌟\n我能直接查馆藏真实数据，还能帮你办事：\n· 找书 / 荐书 / 相似书\n· 查库存、索书号、馆藏位置\n· 查你的借阅与到期\n· 帮你提交借阅申请、归还图书（登录读者账号后）\n· 馆藏统计、热门榜、读者口碑\n· 借阅规则答疑、单本导读', 'ai',
      [], ['帮我借《乡土中国》', '推荐几本书', '热门榜', '馆藏有多少本书？']);
  }
  function toggle() {
    const p = $('#ai-panel');
    if (p.classList.contains('hidden')) { p.classList.remove('hidden'); welcome(); $('#ai-input').focus(); }
    else p.classList.add('hidden');
  }
  async function reset() {
    try { await API.aiReset(); } catch (e) {}
    const log = $('#ai-log');
    log.innerHTML = '';
    log.dataset.welcomed = '';
    welcome();
  }
  function init() {
    $('#ai-fab').addEventListener('click', toggle);
    $('#ai-close').addEventListener('click', () => $('#ai-panel').classList.add('hidden'));
    $('#ai-send').addEventListener('click', () => send());
    $('#ai-input').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    const rb = $('#ai-reset');
    if (rb) rb.addEventListener('click', reset);
    // 自由伸缩：按住面板右下角手柄拖拽，实时调整宽高（带最小/视口限制）
    const panel = $('#ai-panel'), rz = $('#ai-resizer');
    if (rz && panel) {
      let sx = 0, sy = 0, sw = 0, sh = 0, dragging = false;
      const onMove = e => {
        if (!dragging) return;
        const w = Math.max(320, Math.min(window.innerWidth - 48, sw + (e.clientX - sx)));
        const h = Math.max(360, Math.min(window.innerHeight - 48, sh + (e.clientY - sy)));
        panel.style.width = w + 'px';
        panel.style.height = h + 'px';
      };
      const onUp = () => {
        dragging = false;
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      rz.addEventListener('pointerdown', e => {
        dragging = true; sx = e.clientX; sy = e.clientY;
        sw = panel.offsetWidth; sh = panel.offsetHeight;
        e.preventDefault();
        document.body.style.userSelect = 'none';
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    }
    // 点击推荐书目卡片 → 跳详情
    $('#ai-log').addEventListener('click', e => {
      const chip = e.target.closest('.ai-chip');
      if (chip) {
        const go = chip.dataset.go;
        if (go) { location.hash = go; $('#ai-panel').classList.add('hidden'); return; }
        send(chip.textContent.trim()); return;
      }
      const b = e.target.closest('.b');
      if (b) { location.hash = '#/book/' + b.dataset.id; $('#ai-panel').classList.add('hidden'); }
    });
  }
  return { init, toggle, send, reset };
})();
window.AIWidget = AIWidget;
