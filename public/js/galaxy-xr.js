// 真 WebXR（轨道 2）：沉浸式 VR 星系。
// 由 galaxy.js 在 navigator.xr 支持时动态 import；THREE(T) 与星系实例由 enter/createXRButton 注入，
// 本模块不 import three（保证与主程序共用同一份 vendor 实例）。
//
// 核心设计：
//  - 「XR 坐标副本」而非缩放世界组：r160 的 Points.raycast 会把拾取阈值除以物体 scale，
//    缩放组会导致手柄瞄不准；改为把坐标一次性烘焙到 XR 尺度（XR_S=0.07，盘半径≈5m），
//    sessionend 恢复原数组。烘焙时顺带绕 X 倾斜 -10°、整体下沉 0.9m，盘面在胸口高度铺开。
//  - 手柄射线：r160 没有 Raycaster.setFromXRController，手写 getWorldPosition/Direction + raycaster.set。
//  - VR 内标签：12 张 CanvasTexture Sprite（DOM 在头显里不可见）。
//  - 天空：BackSide 大球 + 纯 shader 渐变星云（无贴图，file:// 也安全）。
//    注意：不加 FogExp2 —— 场景全部是 AdditiveBlending 材质，混入雾色会产生灰霾。

const XR_S = 0.07;          // 桌面单位 → 米
const XR_TILT = -10 * Math.PI / 180;
const XR_SINK = 0.9;        // 盘面下沉（米）
const XR_PLAYER = [0, 0, 3.6]; // 站位（距核心 3.6m）
const STRIDE = 3;           // 馆藏点降载采样（120k → 40k）
const LABEL_CULL_M = 12;    // 标签远距降透明

// —— 坐标烘焙：缩放 + 倾斜 + 下沉 ——
function bake(x, y, z) {
  const X = x * XR_S, Y = y * XR_S, Z = z * XR_S;
  const c = Math.cos(XR_TILT), s = Math.sin(XR_TILT);
  return [X, Y * c - Z * s - XR_SINK, Y * s + Z * c];
}

function makeLabelTexture(T, w) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(10,16,30,0.8)';
  g.beginPath();
  if (g.roundRect) g.roundRect(4, 4, 504, 120, 18); else g.rect(4, 4, 504, 120);
  g.fill();
  g.strokeStyle = 'rgba(255,195,94,0.65)';
  g.lineWidth = 2;
  g.stroke();
  const code = String(w.code || '未命名星');
  const title = String(w.title || '');
  // 中文字体缺失探测：量一个汉字的宽度，过小说明回退到了无 CJK 字体 → 降级只显示代号
  g.font = '700 44px "Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
  const cjkOk = g.measureText('中').width > 20;
  g.fillStyle = '#ffd9a3';
  g.textBaseline = 'top';
  if (cjkOk) {
    g.font = '700 44px "Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText(truncate(g, code, 480), 28, 16);
    g.font = '500 36px "Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
    g.fillStyle = '#e8eefc';
    g.fillText(truncate(g, title, 480), 28, 72);
  } else {
    g.font = '700 52px sans-serif';
    g.fillText(truncate(g, code, 480), 28, 34);
  }
  return new T.CanvasTexture(cv);
}
function truncate(g, s, maxW) {
  s = String(s || '');
  if (g.measureText(s).width <= maxW) return s;
  while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

// —— 进入 VR：构建 XR 场景态 ——
export function enter(g, T) {
  if (g._xr) return;
  const xr = g._xr = { T, raycaster: new T.Raycaster() };
  xr.raycaster.params.Points.threshold = 0.2;

  // 1) 馆藏点云 → XR 副本（降载采样 + 烘焙）
  const bp = g.bookPoints;
  const srcAttr = bp.geometry.getAttribute('position');
  const src = srcAttr.array;
  const n = Math.floor(srcAttr.count / STRIDE);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = i * STRIDE;
    const p = bake(src[j * 3], src[j * 3 + 1], src[j * 3 + 2]);
    arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = p[2];
  }
  xr.bookAttr = srcAttr;
  xr.bookSize = bp.material.size;
  bp.geometry.setAttribute('position', new T.BufferAttribute(arr, 3));
  bp.material.size = 0.11;
  bp.geometry.computeBoundingSphere();
  xr.threshold = g.raycaster.params.Points.threshold;
  g.raycaster.params.Points.threshold = 0.2;

  // 2) 作品亮星
  xr.sprites = (g.workSprites || []).map(sp => ({ sp, p: sp.position.clone() }));
  g.workSprites.forEach(sp => {
    const p = bake(sp.position.x, sp.position.y, sp.position.z);
    sp.position.set(p[0], p[1], p[2]);
  });

  // 3) 核心光球
  xr.coreScale = g.core1 ? g.core1.scale.x : null;
  if (g.core1) g.core1.scale.setScalar(2.4);

  // 4) 环境星
  const am = g.ambient;
  if (am) {
    const aAttr = am.geometry.getAttribute('position');
    xr.ambientAttr = aAttr;
    xr.ambientArr = aAttr.array.slice();
    const aa = aAttr.array;
    for (let i = 0; i < aa.length; i += 3) {
      const p = bake(aa[i], aa[i + 1], aa[i + 2]);
      aa[i] = p[0]; aa[i + 1] = p[1]; aa[i + 2] = p[2];
    }
    aAttr.needsUpdate = true;
    am.geometry.computeBoundingSphere();
    xr.ambientSize = am.material.size;
    am.material.size = 0.08;
  }

  // 5) 相机站位（XR 中 WebXRManager 用相机自身 transform 作为玩家偏移）
  xr.camPos = g.camera.position.clone();
  g.camera.position.set(XR_PLAYER[0], XR_PLAYER[1], XR_PLAYER[2]);

  // 6) 天空球 + 背景
  xr.prevBackground = g.scene.background;
  g.scene.background = new T.Color(0x05070f);
  const skyMat = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'varying vec3 vP;',
      'void main(){',
      '  float h = normalize(vP).y;',
      '  vec3 top = vec3(0.329, 0.404, 0.624);',
      '  vec3 mid = vec3(0.173, 0.227, 0.408);',
      '  vec3 low = vec3(0.086, 0.122, 0.235);',
      '  vec3 col = h > 0.0 ? mix(mid, top, min(1.0, h * 1.6)) : mix(mid, low, min(1.0, -h * 1.4));',
      '  float n = sin(vP.x * 0.06) * sin(vP.z * 0.06) * sin(vP.y * 0.06);',
      '  col += vec3(0.10, 0.08, 0.15) * smoothstep(0.15, 0.9, n);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n')
  });
  xr.sky = new T.Mesh(new T.SphereGeometry(60, 32, 16), skyMat);
  g.scene.add(xr.sky);

  // 7) 手柄：射线 + reticle
  xr.controllers = [];
  for (let i = 0; i < 2; i++) {
    const c = g.renderer.xr.getController(i);
    const lg = new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, 0), new T.Vector3(0, 0, -1)]);
    const line = new T.Line(lg, new T.LineBasicMaterial({ color: 0xffc35e, transparent: true, opacity: 0.85 }));
    line.scale.z = 5;
    c.add(line);
    const ret = new T.Mesh(
      new T.RingGeometry(0.012, 0.02, 24),
      new T.MeshBasicMaterial({ color: 0xffc35e, side: T.DoubleSide, transparent: true })
    );
    ret.visible = false;
    c.add(ret);
    c.userData._ray = line;
    c.userData._ret = ret;
    const onSelect = () => selectByController(g, c);
    c.addEventListener('selectstart', onSelect);
    c.userData._onSelect = onSelect;
    g.scene.add(c);
    xr.controllers.push(c);
  }

  // 8) VR 内标签（CanvasTexture Sprite）
  xr.labels = [];
  (g.workSprites || []).forEach(sp => {
    const w = (sp.userData && sp.userData.work) || {};
    const tex = makeLabelTexture(T, w);
    const spr = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
    spr.scale.set(0.9, 0.225, 1);
    spr.position.copy(sp.position);
    spr.position.y += 0.35;
    g.scene.add(spr);
    xr.labels.push({ spr, tex });
  });

  // 9) 降载：注视点渲染
  try { g.renderer.xr.setFoveation(1.0); } catch (e) {}
}

// —— 手柄拾取（r160 无 setFromXRController，手写 origin/direction） ——
function controllerRay(g, c, T) {
  const xr = g._xr;
  const o = new T.Vector3(), d = new T.Vector3();
  c.getWorldPosition(o);
  c.getWorldDirection(d);
  xr.raycaster.ray.origin.copy(o);
  xr.raycaster.ray.direction.copy(d);
  const targets = [...(g.workSprites || []), g.bookPoints];
  const hits = xr.raycaster.intersectObjects(targets, false);
  return hits.length ? hits[0] : null;
}
function selectByController(g, c) {
  if (!g || g.disposed || !g._xr) return;
  const hit = controllerRay(g, c, g._xr.T);
  if (!hit) return;
  const u = hit.object.userData || {};
  if (u.work) location.hash = '#/work/' + u.work.id;
  else if (u.book) location.hash = '#/library';
}

// —— 每帧（XR 会话中）：reticle 吸附 + 标签远近透明 ——
export function frameUpdate(g) {
  const xr = g._xr;
  if (!xr || !xr.T || !xr.raycaster) return;
  for (const c of xr.controllers) {
    const ret = c.userData._ret;
    const hit = controllerRay(g, c, xr.T);
    if (hit) {
      ret.visible = true;
      c.worldToLocal(ret.position.copy(hit.point));
    } else {
      ret.visible = false;
    }
  }
  const cam = g.camera;
  for (const { spr } of xr.labels) {
    const d = spr.position.distanceTo(cam.position);
    spr.material.opacity = d > LABEL_CULL_M ? 0.25 : Math.max(0.25, 1 - (d - 4) / LABEL_CULL_M);
  }
}

// —— 退出 VR：全量还原桌面态 ——
export function leave(g) {
  const xr = g._xr;
  if (!xr) return;
  g._xr = null;
  const bp = g.bookPoints;
  bp.geometry.setAttribute('position', xr.bookAttr);
  bp.material.size = xr.bookSize;
  bp.geometry.computeBoundingSphere();
  g.raycaster.params.Points.threshold = xr.threshold;
  if (xr.sprites) xr.sprites.forEach(({ sp, p }) => sp.position.copy(p));
  if (xr.coreScale && g.core1) g.core1.scale.setScalar(xr.coreScale);
  if (xr.ambientArr) {
    const aAttr = g.ambient.geometry.getAttribute('position');
    aAttr.array.set(xr.ambientArr);
    aAttr.needsUpdate = true;
    g.ambient.geometry.computeBoundingSphere();
    g.ambient.material.size = xr.ambientSize;
  }
  if (xr.camPos) g.camera.position.copy(xr.camPos);
  if (xr.sky) { g.scene.remove(xr.sky); xr.sky.geometry.dispose(); xr.sky.material.dispose(); }
  g.scene.background = xr.prevBackground || null;
  if (xr.controllers) {
    xr.controllers.forEach(c => {
      c.removeEventListener('selectstart', c.userData._onSelect);
      const line = c.userData._ray;
      if (line) { line.geometry.dispose(); line.material.dispose(); }
      const ret = c.userData._ret;
      if (ret) { ret.geometry.dispose(); ret.material.dispose(); }
      g.scene.remove(c);
    });
  }
  if (xr.labels) {
    xr.labels.forEach(({ spr, tex }) => {
      g.scene.remove(spr);
      spr.material.dispose();
      tex.dispose();
    });
  }
}

// —— 中文 VR 按钮（替代官方 VRButton：汉化 + 站点视觉统一 + 安全校验） ——
export function createXRButton(g) {
  const btn = document.createElement('button');
  btn.className = 'vr-button';
  btn.textContent = '🥽 进入 VR';
  btn.addEventListener('click', async () => {
    if (g.disposed) return;
    if (g.renderer.xr.isPresenting) {
      try { g.renderer.xr.getSession().end(); } catch (e) {}
      return;
    }
    try {
      g.renderer.xr.setReferenceSpaceType('local-floor');
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
      });
      session.addEventListener('end', () => { btn.textContent = '🥽 进入 VR'; });
      await g.renderer.xr.setSession(session);
    } catch (e) {
      if (typeof window.toast === 'function') window.toast('无法进入 VR：' + (e.message || e), 'err');
    }
  });
  g.renderer.xr.addEventListener('sessionstart', () => { btn.textContent = '✕ 退出 VR'; });
  g.renderer.xr.addEventListener('sessionend', () => { btn.textContent = '🥽 进入 VR'; });
  g.stageEl.appendChild(btn);
  g._vrBtn = btn;
  return btn;
}
