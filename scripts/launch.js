'use strict';
// 一键启动器（v3）—— 自愈式
//
// 旧版三个毛病，这版全修：
//   1. 只判断「端口有没有监听」→ 分不清是本平台还是别的程序，误判后打开别人的页面
//   2. 自己不读 .env → .env 里改 PORT 对启动器无效，永远死磕 3000
//   3. 前台阻塞 → 黑窗口必须常驻，关窗即停服
//
// 现在：探身份 → 端口阶梯 → 后台常驻（日志落 .runtime/platform.log）→ 就绪开浏览器 → 父进程退出
// 起不来则自动开一个可见窗口跑前台模式，把错误直接摆给用户。
//
// 入口：
//   数文拾光.vbs      隐藏窗口调用（日常）
//   启动平台.bat      可见窗口调用（诊断）
//   停止平台.bat      node scripts/launch.js --stop

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

require('./env');   // 必须在读 PORT 之前

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server', 'server.js');
const RUNTIME = path.join(ROOT, '.runtime');
const LOG_PATH = path.join(RUNTIME, 'platform.log');
const INSTANCE_PATH = path.join(RUNTIME, 'instance.json');

const BASE_PORT = Number(process.env.PORT || 3000) || 3000;
const PORT_SPAN = 11;              // 3000 → 3010
const READY_TIMEOUT_MS = 15000;
const PROBE_TIMEOUT_MS = 1500;
const LOG_MAX_BYTES = 2 * 1024 * 1024;

const CANDIDATES = Array.from({ length: PORT_SPAN }, (_, i) => BASE_PORT + i);
const MODE = process.argv[2] || '';

// ---------- 输出 ----------
function line() { console.log('  ' + '─'.repeat(52)); }
function say(s) { console.log('  ' + s); }

// ---------- 工具 ----------
function ensureRuntime() {
  fs.mkdirSync(RUNTIME, { recursive: true });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function tailLog(n) {
  try {
    const all = fs.readFileSync(LOG_PATH, 'utf-8').split(/\r?\n/);
    const body = all.slice(-(n || 30)).join('\n').trim();
    return body || '(日志为空)';
  } catch (e) { return '(暂无日志)'; }
}

function rotateLog() {
  try {
    const st = fs.statSync(LOG_PATH);
    if (st.size > LOG_MAX_BYTES) fs.renameSync(LOG_PATH, LOG_PATH + '.1');
  } catch (e) { /* 不存在就跳过 */ }
}

/**
 * 探测端口上跑的是谁
 * @returns {Promise<'ours'|'other'|'free'>}
 */
function probe(port) {
  return new Promise(resolve => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/health', timeout: PROBE_TIMEOUT_MS },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', c => { if (body.length < 8192) body += c; });
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            resolve(j && j.app === 'dh-platform' ? 'ours' : 'other');
          } catch (e) { resolve('other'); }
        });
        res.on('error', () => resolve('other'));
      }
    );
    req.on('timeout', () => { req.destroy(); resolve('other'); });          // 有监听但不说人话
    req.on('error', e => resolve(e.code === 'ECONNREFUSED' ? 'free' : 'other'));
  });
}

/** 取某个端口上平台的 pid（health 里带） */
function fetchHealth(port) {
  return new Promise(resolve => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/health', timeout: PROBE_TIMEOUT_MS },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', c => { body += c; });
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { resolve(null); } });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function readInstance() {
  try { return JSON.parse(fs.readFileSync(INSTANCE_PATH, 'utf-8')); } catch (e) { return null; }
}

function writeInstance(obj) {
  ensureRuntime();
  try { fs.writeFileSync(INSTANCE_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf-8'); } catch (e) {}
}

function clearInstance() {
  try { fs.unlinkSync(INSTANCE_PATH); } catch (e) {}
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function killPid(pid) {
  if (!pid) return false;
  if (process.platform === 'win32') {
    // /T 连子进程一起，/F 强制（node 控制台程序不响应正常关闭消息）
    const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return r.status === 0;
  }
  try { process.kill(pid, 'SIGTERM'); return true; } catch (e) { return false; }
}

function openBrowser(url) {
  // 测试/无头环境用 DH_NO_OPEN=1 抑制弹窗，只打印地址
  if (process.env.DH_NO_OPEN === '1') { say(`· (已抑制自动打开) 地址：${url}`); return; }
  const cmd = process.platform === 'win32' ? 'cmd'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch (e) {}
}

/** 失败兜底：把命令写成一个 bat 再 start 它 —— 避免 cmd/start/cmd /k 三层引号嵌套 */
function fallbackForeground(port) {
  say('· 后台启动未就绪，正在打开前台窗口以便查看报错…');
  ensureRuntime();
  const bat = path.join(RUNTIME, 'foreground.bat');
  // 内容用英文：bat 由 cmd 按 ANSI 解析，UTF-8 中文可能乱码
  fs.writeFileSync(bat, [
    '@echo off',
    'chcp 65001 >nul',
    'title ShuWen DH Platform - Debug',
    `cd /d "${ROOT}"`,
    `set "PORT=${port}"`,
    `"${process.execPath}" "${SERVER}"`,
    'echo.',
    'echo [INFO] The service above has exited. The log above IS the error.',
    'echo        Also check .runtime\\platform.log',
    'pause',
    ''
  ].join('\r\n'), 'utf-8');
  // 测试/无头环境只写 bat 不弹窗
  if (process.env.DH_NO_OPEN === '1') { say(`· (已抑制弹窗) 前台调试脚本已生成：${bat}`); return; }
  try {
    // start 的第一个引号参数会被当成窗口标题，所以这里保持空字符串占位
    spawn('cmd', ['/c', 'start', '', bat], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: false }).unref();
  } catch (e) {
    say('✗ 无法自动打开前台窗口，请手动双击「启动平台.bat」查看报错');
  }
}

// ---------- 前置检查 ----------
function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    say(`✗ Node.js 版本过低（当前 ${process.versions.node}），需要 18 或更高`);
    say('  请到 https://nodejs.org 下载 LTS 版本安装后重试');
    process.exit(1);
  }
  say(`· Node.js ${process.versions.node} ✓`);
}

/**
 * 找到可用的 npm：
 * 1) PATH 里的 npm / npm.cmd
 * 2) 当前 node 发行版自带的 npm-cli.js（完整安装版 node.exe 旁边有 node_modules/npm）
 * 注意：裸 node.exe（有人只拷一个 exe 放进 PATH）旁边没有 npm，返回 null 并给指引
 */
function findNpm() {
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    if (spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0) {
      return { cmd, args: [], shell: process.platform === 'win32' };
    }
  } catch (e) { /* 不在 PATH */ }
  const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(bundled)) return { cmd: process.execPath, args: [bundled], shell: false };
  return null;
}

function npmHint() {
  say('✗ 未找到可用的 npm。');
  say('  如果你只把一个 node.exe 拷进了 PATH（比如 D:\\node.exe），它是不带 npm 的；');
  say('  请到 https://nodejs.org 安装完整版 Node.js（自带 npm），装完重新双击本入口。');
  say('  （依赖目录 node_modules 已随项目提供时，日常启动不需要 npm。）');
}

function ensureDeps() {
  const dep = path.join(ROOT, 'node_modules', 'better-sqlite3');
  if (fs.existsSync(dep) && fs.existsSync(path.join(ROOT, 'node_modules', 'express'))) {
    say('· 依赖已就绪 ✓');
    return true;
  }
  const npm = findNpm();
  if (!npm) { say('· 首次运行需要安装依赖，但——'); npmHint(); process.exit(1); }
  say('· 首次运行，正在安装依赖（大约 1—3 分钟，只做一次）…');
  const r = spawnSync(npm.cmd, [...npm.args, 'install', '--no-fund', '--no-audit'], {
    cwd: ROOT, stdio: 'inherit', shell: npm.shell
  });
  if (r.status !== 0) {
    say('✗ 依赖安装失败。请检查网络，或手动执行：npm install');
    process.exit(1);
  }
  say('· 依赖安装完成 ✓');
  return true;
}

/**
 * 原生模块 ABI 预检：换过 node 大版本后 better-sqlite3 会 ERR_DLOPEN_FAILED。
 * v13+ 是 N-API 单二进制（ABI 无关），重装一次即永久解决。
 */
function ensureNative() {
  const pkg = path.join(ROOT, 'node_modules', 'better-sqlite3');
  if (!fs.existsSync(pkg)) return ensureDeps();   // 连包都没有，走依赖安装
  try {
    // 注意：better-sqlite3 是懒加载，require() 本身不加载二进制，
    // 必须 new 一个实例才真正 dlopen —— 只 require 会漏检 ERR_DLOPEN_FAILED
    const Better = require(pkg);
    new Better(':memory:').close();
    say('· 原生模块检查通过 ✓');
    return true;
  } catch (e) {
    if (e.code !== 'ERR_DLOPEN_FAILED') {
      say(`✗ better-sqlite3 加载异常：${e.message}`);
      return false;
    }
    say('· 检测到 Node.js 版本升级导致原生模块不兼容，自动修复中…');
    const npm = findNpm();
    if (!npm) {
      say('✗ 无法自动修复——');
      npmHint();
      say(`  或手动重装一次：删掉 node_modules\\better-sqlite3 后用 npm 装 better-sqlite3@latest`);
      return false;
    }
    say('· 正在重装 better-sqlite3（约 10—40 秒，视网络）…');
    // npm 对"版本已满足"的包不会重新下载 prebuilds —— 必须先删掉坏包再装
    try { fs.rmSync(pkg, { recursive: true, force: true }); } catch (e2) { /* 尽力而为 */ }
    const r = spawnSync(npm.cmd, [...npm.args, 'install', 'better-sqlite3@latest', '--no-fund', '--no-audit'], {
      cwd: ROOT, stdio: 'inherit', shell: npm.shell
    });
    if (r.status !== 0) { say('✗ 自动修复失败（npm install 非零退出）'); return false; }
    // 用独立子进程复检（本进程的 require 缓存已不可靠）
    const check = spawnSync(process.execPath, ['-e', `new (require(${JSON.stringify(pkg)}))(':memory:').close()`], { stdio: 'ignore' });
    if (check.status === 0) {
      say('✓ 修复完成 ✓');
      return true;
    }
    say('✗ 修复后仍无法加载，请把下面的信息反馈给开发者：');
    return false;
  }
}

// ---------- 主流程 ----------
async function start() {
  console.log('');
  line();
  say('数文拾光 · 数字人文平台');
  line();

  checkNode();
  ensureDeps();
  ensureNative();
  ensureRuntime();

  // 1) 扫端口：先找自己，再找空位
  const busy = [];
  let freePort = null;
  for (const port of CANDIDATES) {
    const st = await probe(port);
    if (st === 'ours') {
      say(`· 检测到平台已在 ${port} 端口运行，直接打开浏览器`);
      const h = await fetchHealth(port);
      writeInstance({ pid: (h && h.pid) || (readInstance() || {}).pid || null, port, startedAt: new Date().toISOString(), reused: true });
      openBrowser(`http://localhost:${port}`);
      say('');
      say('  想彻底停掉：双击「停止平台.bat」');
      return 0;
    }
    if (st === 'other') { busy.push(port); continue; }
    freePort = port;
    break;
  }

  if (!freePort) {
    say(`✗ ${CANDIDATES[0]}—${CANDIDATES[CANDIDATES.length - 1]} 全部被其他程序占用`);
    say(`  被占用的端口：${busy.join(', ')}`);
    say('  处理办法：关掉占用这些端口的程序，或在 .env 里把 PORT 改成 3100 之类');
    return 1;
  }

  if (busy.length) {
    say(`· ${busy.join(', ')} 被其他程序占用，改用 ${freePort}`);
  }

  // 2) 后台起服务
  rotateLog();
  ensureRuntime();
  const fd = fs.openSync(LOG_PATH, 'a');
  fs.writeSync(fd, `\n===== ${new Date().toISOString()} 启动 · 端口 ${freePort} =====\n`);

  say(`· 正在启动服务（端口 ${freePort}）…`);
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, PORT: String(freePort) }
  });
  child.unref();

  // 3) 等就绪
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let ok = false;
  while (Date.now() < deadline) {
    await sleep(300);
    if (await probe(freePort) === 'ours') { ok = true; break; }
    if (child.exitCode !== null) break;   // 子进程已退出（无论码值），服务不可能再就绪
  }

  if (!ok) {
    killPid(child.pid);
    say('✗ 服务未能就绪（15 秒超时或进程已退出）');
    say('');
    say('  最近日志：');
    line();
    console.log(tailLog(30));
    line();
    fallbackForeground(freePort);
    return 2;
  }

  writeInstance({ pid: child.pid, port: freePort, startedAt: new Date().toISOString() });
  openBrowser(`http://localhost:${freePort}`);

  console.log('');
  line();
  say(`浏览器已打开：http://localhost:${freePort}`);
  say(`后台进程 PID ${child.pid}，日志：.runtime/platform.log`);
  say('管理端：#/manage（口令在项目根目录 .env 里）');
  say('作品目录：public/works/（放进去自动上架）');
  say('停止服务：双击「停止平台.bat」');
  line();
  return 0;
}

async function stop() {
  console.log('');
  line();
  say('数文拾光 · 停止服务');
  line();

  let killed = 0;

  // 1) 先按 instance.json 精确杀
  const inst = readInstance();
  if (inst && inst.pid) {
    if (isAlive(inst.pid) && killPid(inst.pid)) {
      say(`· 已停止后台进程 PID ${inst.pid}（端口 ${inst.port || '?'}）`);
      killed++;
    } else {
      say(`· PID ${inst.pid} 已不在运行（静默清理记录）`);
    }
  }

  // 2) 再按端口兜底扫（防止 instance.json 丢失或 pid 被复用）
  for (const port of CANDIDATES) {
    const st = await probe(port);
    if (st !== 'ours') continue;
    const h = await fetchHealth(port);
    if (h && h.pid && killPid(h.pid)) {
      say(`· 已停止端口 ${port} 上的平台（PID ${h.pid}）`);
      killed++;
    } else {
      say(`· 端口 ${port} 上有平台在跑，但未能停止（可能需要管理员权限）`);
    }
  }

  clearInstance();

  if (killed) say('✓ 已停止');
  else say('· 当前没有运行中的平台服务');
  return 0;
}

async function status() {
  const inst = readInstance();
  const rows = [];
  for (const port of CANDIDATES) {
    const st = await probe(port);
    if (st === 'free') continue;
    const h = st === 'ours' ? await fetchHealth(port) : null;
    rows.push({ port, state: st, pid: h && h.pid });
  }
  const out = { basePort: BASE_PORT, instance: inst, listening: rows };
  console.log(JSON.stringify(out, null, 2));
  return 0;
}

(async () => {
  try {
    if (MODE === '--stop') process.exit(await stop());
    if (MODE === '--status') process.exit(await status());
    process.exit(await start());
  } catch (e) {
    say(`✗ 启动器异常：${e && e.message}`);
    fallbackForeground(BASE_PORT);
    process.exit(3);
  }
})();
