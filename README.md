# 数文拾光 · 数字人文平台

贵州师范大学 **数文拾光 · 数字人文协会** 的综合展示平台：宇宙首页（3D 星系导航）/ 书库（学院真实馆藏）/ 摘星辰（协会可视化实践成果）/ 资讯 · 专业（数字人文动态与学习资源）。

无用户系统、无登录门槛——访客只读浏览；内容由创始人（协会）通过内置管理端统一维护。

---

## 日常怎么打开

| 你想干的事 | 双击哪个 |
|---|---|
| **平时用（推荐）** | `数文拾光.vbs` —— 全程无窗口，1—2 秒后浏览器自己打开 |
| 打不开 / 想看报错 | `启动平台.bat` —— 弹出黑色窗口，错误原样显示 |
| 用完想彻底关掉 | `停止平台.bat` —— 按 PID 精确停止，端口立刻释放 |
| 不想开服务，只想看 | `public/index.html` —— 离线只读快照（无管理端/无 AI/3D 回落 2D） |

**在桌面放个图标（只做一次）**：右键 `数文拾光.vbs` → **发送到** → **桌面快捷方式**，再把名字改成「数文拾光」。

不用操心服务器在不在、端口有没有被占，启动器会自己判断：

- 端口上是**本平台** → 直接打开浏览器，不重复起进程
- 是**别的软件** → 自动换到 3001 / 3002 …，并告诉你换了
- 3000—3010 **全被占** → 明确列出是哪些端口，不会闷着失败
- 后台起不来 → 自动开一个前台窗口把错误摆给你看

后台日志在 `.runtime/platform.log`，出问题先看它。首次运行会自动 `npm install`（约 1—3 分钟，只做一次）。

> macOS / Linux 用 `./start.sh`，它调用的也是同一个 `scripts/launch.js`。

## 三种运行形态

| 形态 | 怎么进入 | 能做什么 |
|---|---|---|
| **① 本地完整版** | 双击 **`数文拾光.vbs`**（或诊断用 `启动平台.bat`） | 全部功能：浏览 + 管理端（上传/编辑/发布） |
| **② 离线快照** | 直接双击 `public/index.html` | 只读浏览全部内容（AI 与管理入口自动隐藏） |
| **③ 静态发布版** | `npm run publish` 后把 `dist-static/` 托管出去 | 分享给同学的只读链接（GitHub Pages / Vercel 等） |

## 宇宙版块：漫游与 VR（v2.2）

- **沉浸漫游**（无需头显）：首页「🚀 进入漫游」→ 3.6s 电影镜头穿越进旋臂，第一人称自由飞行。
  拖拽/单指转向 · `WASD`/方向键推进 · `Q/E` 升降 · `Shift` 加速 · 滚轮/双指脉冲 · 靠近作品亮星浮现卡片 · `Esc` 退出。
- **真 VR（WebXR）**：HTTPS（或 localhost）且浏览器支持 immersive-vr 时自动显示「🥽 进入 VR」。
  手柄射线指星 · 扳机跳转作品页 / 书库；星系缩放到 5m 半径的「站在星系里」比例，VR 内有中文标签。
  局域网 http 与 file:// 打开时按钮自动隐藏（WebXR 要求安全上下文）。
- 离线快照（file://）下 3D/漫游/VR 不可用，自动回退 2D 星空并显示提示。

## 目录速览

```
数文拾光.vbs            ← 双击我（无窗口，日常）
启动平台.bat            ← 诊断入口（有窗口，看得见报错）
停止平台.bat            ← 停止后台服务
scripts/launch.js       启动器：身份探测 → 端口阶梯 → 后台常驻 → 就绪开浏览器
scripts/env.js          .env 加载（server 与启动器共用）
.runtime/               运行态：instance.json（PID/端口）/ platform.log（不入库）
server/                 Node + Express + SQLite 后端
  db.js                 数据表与种子（books / works / posts / settings）
  works-scanner.js      作品目录扫描器
  settings.js / defaults.js   站点文案（后台可改，defaults 是默认值）
  validate.js           payload / 外链安全校验
  snapshot.js           离线快照生成
  publish.js            静态发布导出
  ai.js                 AI 馆员（检索/荐书/导读，无借阅）
public/
  works/                ★ 摘星辰作品目录（放 HTML 就自动上架，见其 README.txt）
  media/                上传的图片 / 视频 / 文件
  covers/               书籍封面（<索书号>.jpg，缺图自动生成占位书封）
  data/snapshot.js      离线快照（npm run snapshot 生成）
dist-static/            静态发布产物（npm run publish 生成）
data/library.db         SQLite 数据库（.bak-* 为备份）
.env                    FOUNDER_PASSCODE（管理口令）/ TOKEN_SECRET / PORT
```

## 怎么加一件摘星辰作品

**推荐做法（零后台操作）**：在 `public/works/` 下建一个目录

```
public/works/03-天狼星-我的作品/
    index.html        ← 必须叫 index.html
    work.json         ← 可选：{"code":"天狼星","issue_no":3,"summary":"…","members":"张三,李四"}
    assets/           ← 图片等资源随便放
```

然后任选其一让平台感知：重启服务 / 管理端「↻ 重新扫描目录」/ 命令行 `npm run works`。
不写 `work.json` 也能上架——标题、简介会自动从 HTML 的 `<title>` 与 `<meta name="description">` 提取；目录名按 `序号-代号-标题` 命名可自动识别期数与代号。单文件作品直接丢一个 `.html` 进 `public/works/` 也行。

删除文件不会丢记录：扫描器只把对应条目标记为「缺失并隐藏」；确要清掉用 `npm run works:prune`。

## 管理端（#/manage）

入口：导航栏右侧的「·」（本地完整版可见）。口令在 `.env` 的 `FOUNDER_PASSCODE`。

| Tab | 能做什么 |
|---|---|
| ✨ 摘星辰作品 | 增删改、排序、期数/代号、运行方式（内嵌沙箱 / 仅新窗口）、重新扫描目录 |
| 📰 资讯 | 增删改、分类、**粘贴原文链接一键抓取标题/摘要/来源** |
| 🎛 站点文案 | 站点名、首页/书库/摘星辰/资讯的全部文案（留空即回落默认值） |
| 🗂 媒体库 | 查看已上传文件、占用体积、被引用处数、删除 |
| 🚀 发布 | 导出静态发布版 / 生成离线快照 |

## 上传与安全约定

- 图片 ≤ 8MB（jpg/png/webp/gif）· 视频 ≤ 200MB（mp4/webm/mov）· 其他 ≤ 50MB（pdf/zip/doc/docx/ppt/pptx/xls/xlsx/txt/md）
- 上传会做扩展名 + MIME + 文件头魔数三重校验，改名伪装会被拒绝
- **HTML 作品不走上传通道**：请放进 `public/works/`（阅读页以沙箱 iframe 运行，与站点隔离；需要 localStorage / 模块加载的作品在 `work.json` 里设 `"mode":"window"`）
- 作品文件路径只允许 `/works/` 或 `/media/` 开头；资讯外链只允许 http/https

## 资讯内容的真实性原则

资讯条目要求「可查证」：每条必须带来源名称与原文链接；日期只写页面能确证的发布日期，查不到就留空并在正文注明「日期以原文为准」。批量入库脚本：`scripts/data/posts-2026.json` + `npm run posts`（按 source_url 幂等，`--force` 才覆盖）。

## 常用命令

```bash
npm start              # 起服务（等价双击 启动平台.bat）
npm run works          # 扫描作品目录（--prune 彻底删除缺失记录）
npm run posts          # 资讯批量入库（--dry-run 试运行 / --force 覆盖）
npm run snapshot       # 生成离线快照 public/data/snapshot.js
npm run publish        # 离线快照 + 静态发布版 dist-static/
```

## 数据备份

数据库在 `data/library.db`（WAL 模式）。改造或批量操作前先备份：

```bash
node -e "const db=require('better-sqlite3')('data/library.db');db.pragma('wal_checkpoint(TRUNCATE)');db.close()"
cp data/library.db data/library.db.bak-$(date +%Y%m%d)
```

## 回归测试

```bash
node scripts/_ai_agent_test.js       # AI 馆员 22 组问法
node scripts/_ai_llm_mock_test.js    # LLM 工具链路与降级
node scripts/_star_layout_test.js    # 星空布局
node scripts/scan-works.js           # 作品目录扫描
```

## 技术栈

Node.js 18+ · Express 4 · better-sqlite3(WAL) · 原生 HTML/CSS/JS SPA · Three.js r160（本地 vendor，3D 不可用时自动降级 2D Canvas 星空）· 零其他运行时依赖。
