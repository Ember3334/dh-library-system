'use strict';
// 一键启动：检查依赖 → 起服务 → 打开浏览器
// 由「启动平台.bat」（Windows）或 start.sh（macOS/Linux）调用
// 之所以把中文提示放在这里而不是 .bat 里：cmd 解析批处理受代码页影响，中文极易乱码
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const URL = `http://localhost:${PORT}`;

function line() { console.log('  ' + '─'.repeat(52)); }
function say(s) { console.log('  ' + s); }

console.log('');
line();
say('数文拾光 · 数字人文平台');
line();

// 1) Node 版本
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  say(`✗ Node.js 版本过低（当前 ${process.versions.node}），需要 18 或更高`);
  say('  请到 https://nodejs.org 下载 LTS 版本安装后重试');
  process.exit(1);
}
say(`· Node.js ${process.versions.node} ✓`);

// 2) 依赖
const dep = path.join(ROOT, 'node_modules', 'better-sqlite3');
if (!fs.existsSync(dep) || !fs.existsSync(path.join(ROOT, 'node_modules', 'express'))) {
  say('· 首次运行，正在安装依赖（大约 1—3 分钟，只做一次）…');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', '--no-fund', '--no-audit'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    say('✗ 依赖安装失败。请检查网络，或手动在本目录执行：npm install');
    process.exit(1);
  }
  say('· 依赖安装完成 ✓');
} else {
  say('· 依赖已就绪 ✓');
}

// 3) 端口
function checkPort(port) {
  return new Promise(resolve => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(1200, () => { s.destroy(); resolve(false); });
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'cmd'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
}

(async () => {
  if (await checkPort(PORT)) {
    say(`· 端口 ${PORT} 已有服务在跑，直接打开浏览器`);
    say(`  如果页面打不开，可能是别的程序占用了端口：在 .env 里加一行 PORT=3001 换端口`);
    openBrowser(URL);
    say('');
    say('  关闭本窗口不会停止已存在的服务。');
    process.exit(3);   // 交给 .bat 决定是否 pause，避免窗口一闪而过
  }

  say(`· 启动服务中…`);
  say('');
  line();
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT, stdio: 'inherit', env: process.env
  });

  setTimeout(() => {
    openBrowser(URL);
    console.log('');
    line();
    say(`浏览器已打开：${URL}`);
    say('管理端：#/manage（口令在项目根目录 .env 的 FOUNDER_PASSCODE）');
    say('作品目录：public/works/（放进去自动上架）');
    say('停止服务：直接关掉这个窗口，或按 Ctrl + C');
    line();
  }, 1400);

  child.on('exit', code => {
    if (code && code !== 0) {
      say(`服务退出（代码 ${code}）。常见原因：端口被占用 / 数据库被其他程序锁住。`);
      say('排查：先关掉其他平台窗口；或在 .env 里加 PORT=3001 换端口。');
    }
    process.exit(code || 0);
  });

  process.on('SIGINT', () => { child.kill('SIGINT'); });
})();
