'use strict';
// 沉浸宇宙漫游（轨道 1）：全屏第一人称穿越星系，无需头显，任何现代浏览器可玩。
// 依赖：galaxy.js 在 setMode('fly') 时调用 GalaxyFly.attach(instance, THREE)，
//       主循环里调用 GalaxyFly.update / updateLabels；退出/销毁调用 detach / destroy。
// 手感：拖拽/单指转向 · WASD+QE 推进 · 滚轮/双指脉冲 · Shift 加速 · Esc 退出。
window.GalaxyFly = (() => {
  let rig = null; // 单例（同一时刻只有一个星系实例在漫游）

  const FOV_FLY = 62;          // 漫游基础视场角
  const FOV_MAX = FOV_FLY + 8; // 速度感加 fov
  const ACCEL = 30;            // 加速度 u/s²
  const DAMP = 3.2;            // 线性阻尼 /s
  const V_MAX = 12;            // 常规限速
  const V_BOOST = 26;          // Shift 限速
  const WHEEL_IMPULSE = 0.9;   // 滚轮每档速度增量
  const V_WHEEL_MAX = 18;
  const SMOOTH = 0.18;         // 转向指数平滑
  const NEAR_CARD = 26;        // 近星卡片触发距离
  const NEAR_HIDE = 30;        // 收起距离
  const LABEL_CULL = 140;      // 漫游中标签剔除距离

  function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function easeInOutCubic(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function easeInOutQuint(x) { return x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2; }

  class FlightRig {
    constructor(g, T) {
      this.g = g; this.T = T;
      this.mode = 'cine';                 // cine → fly → exit → (销毁)
      this.keys = new Set();
      this.vel = new T.Vector3();
      this.yaw = 0; this.pitch = 0;
      this.yawT = 0; this.pitchT = 0;
      this.time = 0;
      this.boost = false;
      this.pointers = new Map();          // pointerId → {x,y}
      this.downPos = null; this.downTime = 0;
      this.pinY = null;                   // 双指纵向推进基准
      this.reduced = g.reduced;
      this.isMobile = g.isMobile;
      this._v1 = new T.Vector3(); this._v2 = new T.Vector3(); this._v3 = new T.Vector3();
      this._acc = new T.Vector3();        // 复用：帧内加速度（循环内禁止 new）
      this._q1 = new T.Quaternion();

      // 场景相机要参与渲染（星尘挂在相机下），必须把相机加入场景
      g.scene.add(g.camera);

      this.buildHUD();
      this.buildDust();
      this.bindInput();

      // 降载：移动端漫游降低 DPR
      if (this.isMobile) { this._prevDPR = g.renderer.getPixelRatio(); g.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); }
      g.camera.fov = this.reduced ? FOV_FLY : 55;
      g.camera.rotation.order = 'YXZ';
      this.bindFullscreen();
      this.enterFS();          // 必须在点击手势的同一调用栈内，否则浏览器拒绝
      this.startCinematic();
    }

    // ---------- HUD ----------
    buildHUD() {
      const g = this.g;
      const hud = document.createElement('div');
      hud.className = 'fly-hud';
      hud.innerHTML = `
        <div class="fly-cine"></div>
        <div class="fly-bar fly-bar-top"></div>
        <div class="fly-bar fly-bar-bottom"></div>
        <div class="fly-reticle"></div>
        <div class="fly-speed">速度 0.0</div>
        <div class="fly-hint">拖拽转向 · WASD / 方向键推进 · 滚轮加速 · Esc 退出</div>
        <button class="fly-fs" title="切换全屏（F11 亦可）">⛶</button>
        <button class="fly-exit" title="退出漫游">✕ 退出漫游</button>
        <div class="fly-star-card" hidden></div>`;
      g.stageEl.appendChild(hud);
      this.hud = hud;
      this.speedEl = hud.querySelector('.fly-speed');
      this.cardEl = hud.querySelector('.fly-star-card');
      this.reticleEl = hud.querySelector('.fly-reticle');
      hud.querySelector('.fly-exit').addEventListener('click', () => { if (window.Galaxy) window.Galaxy.exitFly(); });
      hud.querySelector('.fly-fs').addEventListener('click', () => this.toggleFS());
      // 触发 letterbox 合拢 → 展开（电影感）
      requestAnimationFrame(() => {
        hud.classList.add('cine-on');
        setTimeout(() => hud.classList.remove('cine-on'), this.reduced ? 300 : 1400);
      });
    }

    // ---------- 全屏 ----------
    // 目标：舞台 .star-stage 独占整屏。三条降级全部兜住，绝不阻断漫游。
    fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
    bindFullscreen() {
      // Esc 退出全屏被浏览器吞掉（页面收不到 keydown），fullscreenchange 是唯一可靠信号
      this._onFSChange = () => {
        if (this.fsEl()) return;
        if (this._suppressFS) { this._suppressFS = false; return; }
        if (this.mode === 'exit') return;                 // 我们自己收尾，别重复触发
        if (window.Galaxy) window.Galaxy.exitFly();
      };
      document.addEventListener('fullscreenchange', this._onFSChange);
      document.addEventListener('webkitfullscreenchange', this._onFSChange);
    }
    enterFS() {
      const el = this.g.stageEl;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req) { this.fsHint(); return; }                // 老 Safari / iPhone：元素全屏不存在
      try {
        const p = req.call(el, { navigationUI: 'hide' });
        if (p && p.catch) p.catch(() => this.fsHint());   // iframe 无 allowfullscreen / 非手势调用
      } catch (e) { this.fsHint(); }
    }
    exitFS() {
      if (!this.fsEl()) return;
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (!exit) return;
      try { const p = exit.call(document); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    }
    toggleFS() { if (this.fsEl()) this.exitFS(); else this.enterFS(); }
    fsHint() {
      if (this._fsHinted) return;
      this._fsHinted = true;
      if (typeof window.toast === 'function') window.toast('浏览器未允许自动全屏（可能嵌在预览框里），可按 F11 手动全屏');
    }

    // ---------- 入场电影镜头（3.6s 样条穿越） ----------
    startCinematic() {
      const g = this.g, T = this.T;
      if (this.reduced) { // 降低动效偏好：直接落位
        this.mode = 'fly';
        this.placeAtStart();
        this.hud.classList.add('fly-on');
        return;
      }
      const P0 = g.orbitState.pos.clone();
      const P3 = new T.Vector3(-56, 2.2, -18);
      const curve = new T.CatmullRomCurve3([
        P0,
        new T.Vector3(26, 30, 52),
        new T.Vector3(-34, 8, 44),
        P3
      ]);
      this.cine = { curve, dur: 3.6, t: 0 };
      this.yaw = Math.atan2(P0.x, P0.z); this.pitch = 0.2;
      this.yawT = this.yaw; this.pitchT = this.pitch;
      this.cineStartPos = P0.clone();
    }
    placeAtStart() {
      const g = this.g, T = this.T;
      g.camera.position.set(-56, 2.2, -18);
      const dir = this._v1.set(0, 0, 0).sub(g.camera.position).normalize();
      this.yaw = Math.atan2(-dir.x, -dir.z);
      this.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
      this.yawT = this.yaw; this.pitchT = this.pitch;
      g.camera.rotation.set(this.pitch, this.yaw, 0);
    }

    // ---------- 星尘流（速度感） ----------
    buildDust() {
      const g = this.g, T = this.T;
      if (this.reduced) return;
      const lowEnd = this.isMobile && (navigator.hardwareConcurrency || 8) <= 4;
      const N = lowEnd ? 0 : (this.isMobile ? 200 : 600);
      if (!N) return;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 14;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 9;
        pos[i * 3 + 2] = -4 - Math.random() * 16;
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      const mat = new T.PointsMaterial({
        size: 0.06, color: 0xcfe0ff, transparent: true, opacity: 0.55,
        depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true
      });
      this.dust = new T.Points(geo, mat);
      this.dust.frustumCulled = false;
      g.camera.add(this.dust);
    }

    // ---------- 输入 ----------
    bindInput() {
      const g = this.g;
      const el = g.renderer.domElement;
      this._onDown = e => {
        if (e.target.closest && e.target.closest('.fly-exit,.fly-fs,.fly-star-card')) return;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (!this.downPos) { this.downPos = { x: e.clientX, y: e.clientY }; this.downTime = performance.now(); }
        if (this.pointers.size === 2) { this.pinY = this.avgY(); }
        el.setPointerCapture && el.setPointerCapture(e.pointerId);
      };
      this._onMove = e => {
        if (!this.pointers.has(e.pointerId)) return;
        const prev = this.pointers.get(e.pointerId);
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.mode !== 'fly') return;
        if (this.pointers.size >= 2) {
          // 双指纵向：沿视线脉冲推进
          const ay = this.avgY();
          if (this.pinY != null) this.thrust((this.pinY - ay) * 0.05);
          this.pinY = ay;
          return;
        }
        this.yawT -= dx * 0.0022;
        this.pitchT = Math.max(-75 * Math.PI / 180, Math.min(75 * Math.PI / 180, this.pitchT - dy * 0.0022));
      };
      this._onUp = e => {
        const had = this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.pinY = null;
        if (!had || !this.downPos) return;
        // 点击判定：位移 < 6px 且 < 300ms（区分拖拽转向）
        const dx = e.clientX - this.downPos.x, dy = e.clientY - this.downPos.y;
        const dt = performance.now() - this.downTime;
        this.downPos = null;
        if (this.mode !== 'fly' || dx * dx + dy * dy > 36 || dt > 300) return;
        const rect = el.getBoundingClientRect();
        const ndcV = new this.T.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        const hit = this.g.pickByNDC(ndcV);
        if (!hit) return;
        const u = hit.userData || {};
        if (u.work) location.hash = '#/work/' + u.work.id;
        else if (u.book) location.hash = '#/library';
      };
      this._onKey = e => {
        if (e.key === 'Escape' && this.mode !== 'exit') { if (window.Galaxy) window.Galaxy.exitFly(); return; }
        const k = KEYS[e.code];
        if (!k) return;
        e.preventDefault();
        if (e.type === 'keydown') this.keys.add(k); else this.keys.delete(k);
        this.boost = e.shiftKey;
      };
      this._onKeyUp = e => { const k = KEYS[e.code]; if (k) this.keys.delete(k); this.boost = e.shiftKey; };
      this._onWheel = e => {
        if (this.mode !== 'fly') return;
        e.preventDefault();
        this.thrust(-Math.sign(e.deltaY) * WHEEL_IMPULSE * Math.min(3, Math.abs(e.deltaY) / 100 + 1));
      };
      this._onBlur = () => { this.keys.clear(); this.pointers.clear(); this.pinY = null; };
      el.addEventListener('pointerdown', this._onDown);
      el.addEventListener('pointermove', this._onMove);
      el.addEventListener('pointerup', this._onUp);
      el.addEventListener('pointercancel', this._onUp);
      el.addEventListener('wheel', this._onWheel, { passive: false });
      window.addEventListener('keydown', this._onKey);
      window.addEventListener('keyup', this._onKeyUp);
      window.addEventListener('blur', this._onBlur);
      this.el = el;
    }
    avgY() {
      let s = 0; this.pointers.forEach(p => { s += p.y; });
      return s / Math.max(1, this.pointers.size);
    }
    thrust(dv) {
      // 沿视线方向的脉冲推进（滚轮 / 双指）
      const g = this.g, T = this.T;
      const dir = this._v1.set(0, 0, -1).applyQuaternion(g.camera.quaternion);
      const cap = Math.max(V_WHEEL_MAX, this.vel.length());
      if (this.vel.length() + dv > cap) return;
      this.vel.addScaledVector(dir, dv);
    }

    // ---------- 主更新（galaxy.tick 每帧调用） ----------
    update(g, dt, t) {
      this.time += dt;
      if (this.mode === 'cine') { this.updateCine(dt); return; }
      if (this.mode === 'exit') { this.updateExit(dt); return; }
      // —— 飞行物理 ——
      const cam = g.camera;
      // 转向平滑（帧率无关的指数平滑）
      const f = 1 - Math.pow(1 - SMOOTH, Math.min(dt * 60, 4));
      this.yaw += (this.yawT - this.yaw) * f;
      this.pitch += (this.pitchT - this.pitch) * f;
      cam.rotation.set(this.pitch, this.yaw, 0);
      // 键盘加速度
      const dirF = this._v1.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const dirR = this._v2.set(1, 0, 0).applyQuaternion(cam.quaternion);
      const dirU = this._v3.set(0, 1, 0);
      const a = this._acc.set(0, 0, 0);
      if (this.keys.has('f')) a.addScaledVector(dirF, ACCEL);
      if (this.keys.has('b')) a.addScaledVector(dirF, -ACCEL);
      if (this.keys.has('r')) a.addScaledVector(dirR, ACCEL);
      if (this.keys.has('l')) a.addScaledVector(dirR, -ACCEL);
      if (this.keys.has('u')) a.addScaledVector(dirU, ACCEL);
      if (this.keys.has('d')) a.addScaledVector(dirU, -ACCEL);
      this.vel.addScaledVector(a, dt);
      // 阻尼 + 限速
      this.vel.multiplyScalar(Math.max(0, 1 - DAMP * dt));
      const cap = this.boost ? V_BOOST : V_MAX;
      const sp = this.vel.length();
      if (sp > cap) this.vel.multiplyScalar(cap / sp);
      // 积分 + 边界（软推回）
      cam.position.addScaledVector(this.vel, dt);
      const p = cam.position;
      if (p.y < -3.2) { p.y = -3.2; if (this.vel.y < 0) this.vel.y = 0; }
      if (p.y > 3.6) { p.y = 3.6; if (this.vel.y > 0) this.vel.y = 0; }
      const r = Math.hypot(p.x, p.z);
      if (r > 130) {
        const k = 130 / r;
        p.x *= k; p.z *= k;
        const outX = p.x / (130 * k), outZ = p.z / (130 * k);
        const vr = this.vel.x * outX + this.vel.z * outZ;
        if (vr > 0) { this.vel.x -= vr * outX; this.vel.z -= vr * outZ; }
      } else if (r < 8) {
        const k = 8 / Math.max(0.001, r);
        p.x *= k; p.z *= k;
        const outX = p.x / 8, outZ = p.z / 8;
        const vr = this.vel.x * outX + this.vel.z * outZ;
        if (vr < 0) { this.vel.x -= vr * outX; this.vel.z -= vr * outZ; }
      }
      // 速度感：FOV 随速度轻微拉伸
      const spd = this.vel.length();
      const targetFov = FOV_FLY + Math.min(8, spd * 0.4);
      if (Math.abs(cam.fov - targetFov) > 0.05) {
        cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 5);
        cam.updateProjectionMatrix();
      }
      // HUD
      if (this.speedEl) this.speedEl.textContent = '速度 ' + spd.toFixed(1);
      // 星尘流动（相机空间 z 轴回绕）
      if (this.dust) {
        const arr = this.dust.geometry.attributes.position;
        const flow = Math.min(spd, 24) * dt * 2.4;
        for (let i = 0; i < arr.count; i++) {
          let z = arr.getZ(i) + flow;
          if (z > -4) { z -= 16; arr.setX(i, (Math.random() - 0.5) * 14); arr.setY(i, (Math.random() - 0.5) * 9); }
          arr.setZ(i, z);
        }
        arr.needsUpdate = true;
      }
    }

    updateCine(dt) {
      const g = this.g, T = this.T;
      const c = this.cine;
      c.t += dt;
      const raw = Math.min(1, c.t / c.dur);
      const e = easeInOutQuint(raw);
      // 中段 8% 加速下压（t∈[0.12,0.28]）
      const dip = raw > 0.12 && raw < 0.28 ? Math.sin((raw - 0.12) / 0.16 * Math.PI) * 0.08 : 0;
      const pos = c.curve.getPoint(Math.min(1, e + dip * 0.04 * Math.sin(e * Math.PI)));
      g.camera.position.copy(pos);
      // 朝向：前 70% 沿切线，后 30% slerp 转向星核
      if (raw < 0.7) {
        const tan = c.curve.getTangent(Math.min(1, e + 0.02));
        this.yawT = Math.atan2(-tan.x, -tan.z);
        this.pitchT = Math.asin(Math.max(-1, Math.min(1, tan.y)));
      } else {
        const k = (raw - 0.7) / 0.3;
        const toCore = this._v1.set(0, 0, 0).sub(pos).normalize();
        const yawC = Math.atan2(-toCore.x, -toCore.z);
        const pitchC = Math.asin(Math.max(-1, Math.min(1, toCore.y)));
        this.yawT = this.yawT + (yawC - this.yawT) * k * 0.2;
        this.pitchT = this.pitchT + (pitchC - this.pitchT) * k * 0.2;
      }
      const f = 1 - Math.pow(1 - 0.22, Math.min(dt * 60, 4));
      this.yaw += (this.yawT - this.yaw) * f;
      this.pitch += (this.pitchT - this.pitch) * f;
      g.camera.rotation.set(this.pitch, this.yaw, 0);
      // FOV 55 → 68 → 60
      const fov = 55 + 13 * Math.sin(Math.PI * Math.min(1, raw * 1.05));
      g.camera.fov = raw >= 1 ? FOV_FLY : fov;
      g.camera.updateProjectionMatrix();
      if (raw >= 1) {
        this.mode = 'fly';
        this.vel.set(0, 0, 0);
        this.keys.clear();
        this.hud.classList.add('fly-on');
      }
    }

    // —— 退出：0.9s 缓动回俯视机位 ——
    beginExit() {
      if (this.mode === 'exit') return;
      this.mode = 'exit';
      this.hud.classList.remove('fly-on');
      const g = this.g, T = this.T;
      this.exit = {
        t: 0, dur: this.reduced ? 0.2 : 0.9,
        p0: g.camera.position.clone(),
        p1: g.orbitState.pos.clone(),
        q0: g.camera.quaternion.clone()
      };
      // 目标朝向：从终点机位看向原 target
      const m = new T.Matrix4().lookAt(g.orbitState.pos, g.orbitState.target, T.Object3D.DEFAULT_UP || new T.Vector3(0, 1, 0));
      this.exit.q1 = new T.Quaternion().setFromRotationMatrix(m);
    }
    updateExit(dt) {
      const g = this.g;
      const ex = this.exit;
      ex.t += dt;
      const raw = Math.min(1, ex.t / ex.dur);
      const e = easeInOutCubic(raw);
      g.camera.position.lerpVectors(ex.p0, ex.p1, e);
      g.camera.quaternion.slerpQuaternions(ex.q0, ex.q1, e);
      if (raw >= 1) {
        this.cleanup(true);
        g._restoreOrbit();
      }
    }

    // ---------- 标签与近星卡片 ----------
    updateLabels(g, t) {
      // 漫游中：距离剔除，近处才显示 DOM 标签
      const v = this._v1;
      for (const { el, pos } of g.labels) {
        const d = v.copy(pos).distanceTo(g.camera.position);
        const show = d < LABEL_CULL;
        if (show !== (el.style.display !== 'none')) el.style.display = show ? 'block' : 'none';
        if (show) {
          v.copy(pos).project(g.camera);
          if (v.z < 1) {
            el.style.transform = 'translate3d(-50%,-100%,0)';
            el.style.left = ((v.x * 0.5 + 0.5) * g.stageEl.clientWidth) + 'px';
            el.style.top = ((-v.y * 0.5 + 0.5) * g.stageEl.clientHeight - 18) + 'px';
          }
        }
      }
      // 近星卡片：距作品亮星 < NEAR_CARD 时浮现
      let near = null, nd = NEAR_CARD;
      if (g.workSprites) {
        for (const sp of g.workSprites) {
          const d = sp.position.distanceTo(g.camera.position);
          if (d < nd) { nd = d; near = sp; }
        }
      }
      if (near !== this.nearStar) {
        if (this.nearStar) this.nearStar.material.opacity = 1;
        this.nearStar = near;
        if (near) {
          near.material.opacity = 1;
          const w = near.userData.work || {};
          this.cardEl.innerHTML = `
            <b>${escHtml(w.code || '未命名星')}</b>
            <div class="t">${escHtml(w.title || '')}</div>
            <div class="m">第 ${w.issue_no || '—'} 期 · ${escHtml(w.members || '')}</div>
            <button class="fly-card-btn">进入作品 →</button>`;
          this.cardEl.querySelector('.fly-card-btn').onclick = () => { location.hash = '#/work/' + w.id; };
          this.cardEl.hidden = false;
        } else {
          this.cardEl.hidden = true;
        }
      }
      if (near) {
        // 卡片跟随投影
        const pv = this._v2.copy(near.position).project(g.camera);
        if (pv.z < 1) {
          this.cardEl.style.left = ((pv.x * 0.5 + 0.5) * g.stageEl.clientWidth) + 'px';
          this.cardEl.style.top = ((-pv.y * 0.5 + 0.5) * g.stageEl.clientHeight) + 'px';
          this.cardEl.hidden = nd > NEAR_HIDE;
        } else this.cardEl.hidden = true;
      }
    }

    // ---------- 清理 ----------
    unbind() {
      const el = this.el;
      if (el) {
        el.removeEventListener('pointerdown', this._onDown);
        el.removeEventListener('pointermove', this._onMove);
        el.removeEventListener('pointerup', this._onUp);
        el.removeEventListener('pointercancel', this._onUp);
        el.removeEventListener('wheel', this._onWheel);
      }
      window.removeEventListener('keydown', this._onKey);
      window.removeEventListener('keyup', this._onKeyUp);
      window.removeEventListener('blur', this._onBlur);
      if (this._onFSChange) {
        document.removeEventListener('fullscreenchange', this._onFSChange);
        document.removeEventListener('webkitfullscreenchange', this._onFSChange);
        this._onFSChange = null;
      }
    }
    removeHUD() { if (this.hud && this.hud.parentNode) this.hud.remove(); }
    cleanup(keepCameraState) {
      this.unbind();
      this.removeHUD();
      this.exitFS();   // 退出动画播完后收回全屏，回到正常视口
      const g = this.g;
      if (this.dust) { g.camera.remove(this.dust); this.dust.geometry.dispose(); this.dust.material.dispose(); this.dust = null; }
      if (this._prevDPR) { g.renderer.setPixelRatio(this._prevDPR); this._prevDPR = null; }
      if (!keepCameraState) { g.scene.remove(g.camera); }
      if (rig === this) rig = null;
    }
  }

  const KEYS = {
    KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b',
    KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
    KeyQ: 'd', KeyE: 'u', Space: 'u', ControlLeft: 'd'
  };

  return {
    attach(g, T) {
      if (rig) rig.cleanup(false);
      rig = new FlightRig(g, T);
      return rig;
    },
    // galaxy.tick 每帧询问：rig 是否存在（含退出动画阶段）
    hasRig(g) { return !!rig && rig.g === g; },
    update(g, dt, t) { if (rig && rig.g === g) rig.update(g, dt, t); },
    updateLabels(g, t) { if (rig && rig.g === g) rig.updateLabels(g, t); },
    // 主动退出（Galaxy.setMode('orbit') 调用）：rig 播放回位动画后自行清理
    detach(g) {
      if (rig && rig.g === g) rig.beginExit();
      else if (rig) { rig.cleanup(false); rig = null; }
    },
    // 实例销毁：立刻清理、不播动画
    destroy(g) {
      if (rig && (!g || rig.g === g)) { rig.cleanup(false); rig = null; }
    },
    // VR 入口要先退出全屏：告诉 fullscreenchange 监听器这次是我们主动的，别当成用户按了 Esc
    suppressNextFSExit() { if (rig) rig._suppressFS = true; }
  };
})();
