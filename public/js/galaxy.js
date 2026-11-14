// 数字人文宇宙 · 3D 星系首页（Three.js，本地 vendor，无 CDN）
// 架构：
//   - 馆藏按分类分布为旋臂的合并 Points（单 draw call）
//   - 摘星辰作品为大号行星（Sprite）+ HTML 标签
//   - OrbitControls 自动缓旋 + 触控；Raycaster 拾取
//   - 降级策略：WebGL 不可用 / import 失败 → 返回 false，前端回退 2D StarScene
//   - WebXR 实验性：navigator.xr 支持沉浸式会话时才显示 VR 按钮
const GALAXY = (() => {
  let instance = null;
  let T = null;        // THREE 模块（init 时注入）
  let OC = null;       // OrbitControls（init 时注入）

  const CATEGORY_COLORS = {
    '文学类': 0xf0a23c, '艺术类': 0xe070a0, '历史': 0x3aa0a2, '思政综合类': 0xb8892e,
    default: 0x9a8cd0
  };
  const WORK_COLOR = 0xffc35e;
  const WORK_ARM = 4; // 摘星辰独立旋臂序号

  function colorForCat(cat) {
    if (cat && CATEGORY_COLORS[cat] !== undefined) return CATEGORY_COLORS[cat];
    if (!cat) return CATEGORY_COLORS.default;
    let h = 0; for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) % 360;
    return new T.Color(`hsl(${h}, 60%, 62%)`);
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 星点贴图（缓存）
  let _starTex = null;
  function starTexture() {
    if (_starTex) return _starTex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.8)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(32, 32, 32, 0, Math.PI * 2); g.fill();
    _starTex = new T.CanvasTexture(c);
    return _starTex;
  }

  // 旋臂布局：与 2D StarScene 同源的 pinwheel 公式
  function armPos(base, t, Rmax, jitter) {
    const WIND = Math.PI * 1.35;
    const theta = base + t * WIND + (Math.random() - 0.5) * (jitter || 0.5);
    const rr = Rmax * Math.pow(t, 0.62) * (0.88 + Math.random() * 0.24);
    return {
      x: Math.cos(theta) * rr,
      y: (Math.random() - 0.5) * 3.2,
      z: Math.sin(theta) * rr
    };
  }

  class Galaxy {
    constructor(canvas, books, opts) {
      this.canvas = canvas;
      this.books = books || [];
      this.works = (opts && opts.works) || [];
      this.disposed = false;
      this.flyMode = false;
      this.labels = [];
      this.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

      const el = canvas.parentElement;
      this.renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(el.clientWidth, el.clientHeight, false);
      this.renderer.xr.enabled = true;

      this.scene = new T.Scene();

      this.camera = new T.PerspectiveCamera(55, el.clientWidth / el.clientHeight, 0.1, 2000);
      this.camera.position.set(0, 46, 88);

      // 悬停提示层
      this.tip = document.createElement('div');
      this.tip.className = 'star-tip';
      el.appendChild(this.tip);

      this.buildCore();
      this.buildBooks();
      this.buildWorks();
      this.buildAmbient();

      this.controls = new OC(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.06;
      this.controls.autoRotate = !this.reduced;
      this.controls.autoRotateSpeed = 0.5;
      this.controls.minDistance = 28;
      this.controls.maxDistance = 240;
      this.controls.maxPolarAngle = Math.PI * 0.48;
      this.controls.target.set(0, 0, 0);

      this.raycaster = new T.Raycaster();
      this.raycaster.params.Points.threshold = 1.6;
      this.pointer = new T.Vector2(-10, -10);
      // 俯视模式状态存档：进出漫游/VR 用
      this.orbitState = { pos: this.camera.position.clone(), target: this.controls.target.clone(), fov: 55, autoRotate: this.controls.autoRotate };
      this.bindEvents();
      this.setupXR();
      this.resize();
      // 统一渲染循环：WebXR 要求 setAnimationLoop（rAF 在 immersive 会话中会被暂停 → 头显黑屏）
      this.clock = new T.Clock();
      this._tick = () => this.tick();
      this.renderer.setAnimationLoop(this._tick);
    }

    get stageEl() { return this.canvas.parentElement; }

    buildCore() {
      const mkGlow = (color, inner, scale) => {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const g = c.getContext('2d');
        const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
        grd.addColorStop(0, inner);
        grd.addColorStop(0.35, color + 'aa');
        grd.addColorStop(1, color + '00');
        g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
        const mat = new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false });
        const sp = new T.Sprite(mat);
        sp.scale.setScalar(scale);
        return sp;
      };
      this.core1 = mkGlow('#ffd9a0', 'rgba(255,248,230,0.95)', 34);
      const core2 = mkGlow('#c9a0ff', 'rgba(210,180,255,0.35)', 70);
      this.scene.add(core2); this.scene.add(this.core1);
    }

    buildBooks() {
      const groups = new Map();
      this.books.forEach(b => { const k = b.category || '其他'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); });
      const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
      const N = sorted.length + 1;
      const Rmax = 72;
      const cap = this.isMobile ? 36000 : 120000;
      const positions = [], colors = [], meta = [];
      sorted.forEach(([key, arr], k) => {
        const base = (k / N) * Math.PI * 2;
        const col = new T.Color(colorForCat(key));
        const step = arr.length > cap ? Math.ceil(arr.length / cap) : 1;
        arr.forEach((b, j) => {
          if (j % step) return;
          const t = (j + 0.5) / arr.length;
          const p = armPos(base, t, Rmax);
          const mag = Math.pow(Math.random(), 2.2);
          const c = col.clone().multiplyScalar(0.55 + 0.45 * mag);
          positions.push(p.x, p.y, p.z);
          colors.push(c.r, c.g, c.b);
          meta.push({ book: b });
        });
      });
      this.bookMeta = meta;
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
      const mat = new T.PointsMaterial({
        size: 1.5, map: starTexture(), vertexColors: true, transparent: true,
        depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true
      });
      this.bookPoints = new T.Points(geo, mat);
      this.scene.add(this.bookPoints);
    }

    buildWorks() {
      const Rmax = 80;
      const base = (WORK_ARM / (WORK_ARM + 1)) * Math.PI * 2 + 0.6;
      const tex = starTexture();
      this.workSprites = [];
      this.works.slice(0, 12).forEach((w, i) => {
        const t = 0.3 + 0.6 * (i / Math.max(1, Math.min(11, this.works.length - 1) || 1));
        const p = armPos(base, t, Rmax, 0.25);
        p.y += 2;
        const mat = new T.SpriteMaterial({
          map: tex, color: WORK_COLOR, transparent: true,
          depthWrite: false, blending: T.AdditiveBlending
        });
        const sp = new T.Sprite(mat);
        sp.position.set(p.x, p.y, p.z);
        sp.scale.setScalar(6.5);
        sp.userData = { work: w };
        this.scene.add(sp);
        this.workSprites.push(sp);
        // HTML 标签（点击直达作品）
        const label = document.createElement('div');
        label.className = 'galaxy-label';
        label.textContent = (w.code ? w.code + ' · ' : '') + w.title;
        label.addEventListener('click', () => { location.hash = '#/work/' + w.id; });
        this.stageEl.appendChild(label);
        this.labels.push({ el: label, pos: sp.position });
      });
    }

    buildAmbient() {
      const count = this.isMobile ? 400 : 900;
      const positions = [];
      for (let i = 0; i < count; i++) {
        const r = 220 + Math.random() * 260;
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        positions.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th));
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
      const mat = new T.PointsMaterial({
        size: 1.1, map: starTexture(), color: 0x8a90c8,
        transparent: true, opacity: 0.5, depthWrite: false, sizeAttenuation: true
      });
      this.ambient = new T.Points(geo, mat);
      this.scene.add(this.ambient);
    }

    bindEvents() {
      const el = this.renderer.domElement;
      el.addEventListener('pointermove', e => {
        const rect = el.getBoundingClientRect();
        this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      });
      el.addEventListener('pointerleave', () => { this.pointer.set(-10, -10); this.clearHover(); });
      el.addEventListener('click', () => {
        const hit = this.pick();
        if (!hit) return;
        const u = hit.userData || {};
        // 门户只做版块导航：书库星点统一进书库首页（书库与摘星辰是两个独立版块，不交叉引用）
        if (u.book) location.hash = '#/library';
        else if (u.work) location.hash = '#/work/' + u.work.id;
      });
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(this.stageEl);
      this._vis = () => {
        // XR 会话中浏览器接管帧节奏（xr frame），不要动 setAnimationLoop
        if (this.renderer.xr && this.renderer.xr.isPresenting) return;
        if (document.hidden) this.renderer.setAnimationLoop(null);
        else if (!this.disposed) this.renderer.setAnimationLoop(this._tick);
      };
      document.addEventListener('visibilitychange', this._vis);
    }

    pick() {
      return this.pickByNDC(this.pointer);
    }
    // 双入口拾取：桌面 hover 用 NDC；漫游点击 / XR 手柄用射线
    pickByNDC(ndc) {
      this.raycaster.setFromCamera(ndc, this.camera);
      return this._pickHits();
    }
    pickByRay(ray) {
      this.raycaster.ray.copy(ray);
      return this._pickHits();
    }
    _pickHits() {
      const hitsW = this.raycaster.intersectObjects(this.workSprites || [], false);
      if (hitsW.length) return hitsW[0].object;
      const hits = this.raycaster.intersectObject(this.bookPoints, false);
      if (hits.length && hits[0].index != null && this.bookMeta[hits[0].index]) {
        return { userData: this.bookMeta[hits[0].index] };
      }
      return null;
    }

    clearHover() {
      this.tip.classList.remove('on');
      this.renderer.domElement.style.cursor = 'default';
    }

    hover() {
      const hit = this.pick();
      if (!hit) { this.clearHover(); return; }
      const u = hit.userData || {};
      let sx = 0, sy = 0;
      if (hit.isSprite) {
        const p = hit.position.clone().project(this.camera);
        sx = (p.x * 0.5 + 0.5) * this.stageEl.clientWidth;
        sy = (-p.y * 0.5 + 0.5) * this.stageEl.clientHeight;
      } else if (hit.index != null) {
        const pos = this.bookPoints.geometry.attributes.position;
        const wp = new T.Vector3(pos.getX(hit.index), pos.getY(hit.index), pos.getZ(hit.index))
          .applyMatrix4(this.bookPoints.matrixWorld).project(this.camera);
        sx = (wp.x * 0.5 + 0.5) * this.stageEl.clientWidth;
        sy = (-wp.y * 0.5 + 0.5) * this.stageEl.clientHeight;
      }
      const b = u.book, w = u.work;
      this.tip.innerHTML = b
        ? `<b>${escHtml(b.title)}</b><div class="m">${escHtml(b.author || '未知')} · ${escHtml(b.category || '')}</div><div class="s">点击查看详情</div>`
        : `<b>${escHtml(w.title)}</b><div class="m">${escHtml(w.code || '')} · 第 ${w.issue_no} 期</div><div class="s">点击打开作品</div>`;
      this.tip.style.left = Math.min(this.stageEl.clientWidth - 110, Math.max(110, sx)) + 'px';
      const flip = sy < 92;
      this.tip.style.transform = flip ? 'translate(-50%,0) translateY(14px)' : 'translate(-50%,-100%) translateY(-14px)';
      this.tip.style.top = (flip ? sy + 8 : sy - 8) + 'px';
      this.tip.classList.add('on');
      this.renderer.domElement.style.cursor = 'pointer';
    }

    setupXR() {
      // 自研中文 VR 按钮：navigator.xr + 安全上下文 + 会话支持 三者齐备才显示
      // （file:// 与局域网 http 自动隐藏，避免「点了没反应」）
      try {
        if (!navigator.xr || !navigator.xr.isSessionSupported || !window.isSecureContext) return;
        navigator.xr.isSessionSupported('immersive-vr').then(ok => {
          if (!ok || this.disposed) return;
          import('./galaxy-xr.js').then(xr => {
            if (this.disposed) return;
            this.xrModule = xr;
            xr.createXRButton(this);
            this.renderer.xr.addEventListener('sessionstart', () => {
              if (this.disposed) return;
              Promise.resolve(xr.enter(this, T)).catch(e => console.warn('[xr] 进入 VR 场景失败：', e));
            });
            this.renderer.xr.addEventListener('sessionend', () => {
              if (this.disposed) return;
              try { xr.leave(this); } catch (e) {}
            });
          }).catch(() => {});
        }).catch(() => {});
      } catch (e) { /* XR 不可用：静默跳过 */ }
    }

    resize() {
      // XR 帧缓冲由 XRWebGLLayer 管理，setSize 会破坏双眼视口
      if (this.renderer.xr && this.renderer.xr.isPresenting) return;
      const el = this.stageEl;
      if (!el) return;
      const w = Math.min(4000, Math.max(320, el.clientWidth || 320));
      const h = Math.min(4000, Math.max(300, el.clientHeight || 300));
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    }

    // —— 模式切换：orbit（俯视轨道）/ fly（第一人称漫游，由 GalaxyFly 驱动）——
    setMode(mode) {
      if (this.disposed) return;
      if (mode === 'fly' && !this.flyMode) {
        this.orbitState = {
          pos: this.camera.position.clone(),
          target: this.controls.target.clone(),
          fov: this.camera.fov,
          autoRotate: this.controls.autoRotate
        };
        this.controls.enabled = false;
        this.controls.autoRotate = false;
        this.clearHover();
        this.flyMode = true;
        if (window.GalaxyFly) window.GalaxyFly.attach(this, T);
        return true;
      }
      if (mode === 'orbit' && this.flyMode) {
        this.flyMode = false;
        if (window.GalaxyFly) window.GalaxyFly.detach(this);
        return true;
      }
      return false;
    }
    // 漫游退出动画完成后的恢复（GalaxyFly 回调）
    _restoreOrbit() {
      this.camera.fov = this.orbitState.fov;
      this.camera.updateProjectionMatrix();
      this.camera.rotation.order = 'XYZ';
      this.camera.position.copy(this.orbitState.pos);
      this.controls.target.copy(this.orbitState.target);
      this.controls.enabled = true;
      this.controls.autoRotate = this.orbitState.autoRotate;
      this.controls.update();
    }

    // 主循环（统一入口：桌面 / 漫游 / XR 三态）
    tick() {
      if (this.disposed) return;
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = performance.now() / 1000;
      const xrPresenting = this.renderer.xr && this.renderer.xr.isPresenting;
      const rigActive = window.GalaxyFly && window.GalaxyFly.hasRig(this);
      if (rigActive) {
        // 漫游或退出动画期间由 FlightRig 驱动相机（exit 阶段 flyMode 已为 false，仍要继续喂帧）
        window.GalaxyFly.update(this, dt, t);
      } else if (!xrPresenting) {
        this.controls.update();
      }
      if (this.core1) this.core1.scale.setScalar(34 + 1.6 * Math.sin(t * 0.9));
      if (this.workSprites) {
        this.workSprites.forEach((sp, i) => {
          sp.scale.setScalar(6.5 + 0.7 * Math.sin(t * 1.2 + i * 1.7));
        });
      }
      if (xrPresenting) {
        // 头显中 DOM 标签/悬停无意义，全部跳过省 CPU；每帧更新手柄 reticle
        if (this.xrModule) this.xrModule.frameUpdate(this);
        return this.renderer.render(this.scene, this.camera);
      }
      if (rigActive) {
        window.GalaxyFly.updateLabels(this, t);
      } else {
        const v = this._lv || (this._lv = new T.Vector3());
        for (const { el, pos } of this.labels) {
          v.copy(pos).project(this.camera);
          const vis = v.z < 1;
          el.style.display = vis ? 'block' : 'none';
          if (vis) {
            el.style.transform = 'translate3d(-50%,-100%,0)';
            el.style.left = ((v.x * 0.5 + 0.5) * this.stageEl.clientWidth) + 'px';
            el.style.top = ((-v.y * 0.5 + 0.5) * this.stageEl.clientHeight - 18) + 'px';
          }
        }
        this._hoverTick = (this._hoverTick || 0) + 1;
        if (this._hoverTick % 3 === 0) this.hover();
      }
      this.renderer.render(this.scene, this.camera);
    }

    destroy() {
      this.disposed = true;
      // XR 会话中销毁：先结束会话（sessionend → xr.leave 还原桌面态）
      if (this.renderer.xr && this.renderer.xr.isPresenting) {
        try { this.renderer.xr.getSession().end(); } catch (e) {}
      }
      if (this.xrModule && this._xr) { try { this.xrModule.leave(this); } catch (e) {} }
      if (this._vrBtn && this._vrBtn.parentNode) this._vrBtn.remove();
      if (window.GalaxyFly) window.GalaxyFly.destroy(this);
      if (this._tick) this.renderer.setAnimationLoop(null);
      if (this._ro) this._ro.disconnect();
      document.removeEventListener('visibilitychange', this._vis || (() => {}));
      if (this.controls) this.controls.dispose();
      if (this.labels) this.labels.forEach(({ el }) => el.remove());
      if (this.tip && this.tip.parentNode) this.tip.remove();
      const vrBtn = this.stageEl.querySelector('.vr-button');
      if (vrBtn) vrBtn.remove();
      try { this.renderer.dispose(); } catch (e) {}
      instance = null;
    }
  }

  // 对外接口：init(canvas, books, opts) → Promise<boolean>；destroy()
  async function init(canvas, books, opts) {
    if (instance) { instance.destroy(); instance = null; }
    try {
      const test = document.createElement('canvas');
      const gl = test.getContext('webgl2') || test.getContext('webgl');
      if (!gl) return false;
    } catch (e) { return false; }
    try {
      if (!T) {
        T = await import('../vendor/three.module.min.js');
        const oc = await import('../vendor/controls/OrbitControls.js');
        OC = oc.OrbitControls;
      }
      instance = new Galaxy(canvas, books, opts);
      return true;
    } catch (e) {
      console.warn('[galaxy] 初始化失败：', e);
      T = null; OC = null;
      return false;
    }
  }

  return {
    init,
    destroy() { if (instance) instance.destroy(); },
    get active() { return !!instance; },
    get current() { return instance; },
    // 俯视 ↔ 漫游切换（views.js 的「进入漫游」按钮调用）
    toggleFly() {
      if (!instance) return false;
      return instance.setMode(instance.flyMode ? 'orbit' : 'fly');
    },
    exitFly() { if (instance && instance.flyMode) instance.setMode('orbit'); }
  };
})();
window.Galaxy = GALAXY;
