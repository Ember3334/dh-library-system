# 数文拾光 · 数字人文平台

面向大学生的数字人文综合性展示平台：宇宙首页（3D 星系）· 书库 · 摘星辰 · 资讯 · AI 馆员。
由创始人统一维护内容，访客免登录只读浏览；支持「本地完整版 + 一键发布纯静态版」双模式。

> 前身是「数字人文学院图书室 AI 智能管理系统」（v1 图书管理），v2.0 扩展为数字人文平台，
> 696 本学院真实馆藏完整保留，借阅/用户体系按平台定位移除。

## 四大版块

| 版块 | 内容 |
|---|---|
| 🌌 宇宙首页 | Three.js 3D 星系：馆藏按分类组成四条旋臂，摘星辰作品是亮星（点击直达），资讯是入口卡；WebGL 不可用自动回退 2D Canvas 星空；实验性 WebXR VR 按钮 |
| 📚 书库 | 696 本学院真实馆藏：检索 / 分类筛选 / 分页 / 详情 / AI 导读；封面按索书号 `/covers/<索书号>.jpg` 加载，缺图自动生成设计感书封 |
| ✨ 摘星辰 | 数文拾光协会周期性可视化实践成果陈列：每件作品含星辰代号（北极星/启明星/织女星…）、期数、成员、简介；支持 交互HTML(iframe 沙箱)/图片/视频/外链 四种形态 |
| 📰 资讯·专业 | 数字人文领域动态 / 时事 / 工具 / 学习资源，图文条目 + 「跳转浏览器原文」外链 |

## 运行架构

- **本地完整版**（日常）：`npm start` → http://localhost:3000 。创始人凭口令进入 `#/manage` 管理端：
  录入/编辑摘星辰作品与资讯、上传图片/视频/HTML 作品文件、一键发布静态版。
- **静态发布版**（分享）：管理端点「发布」或 `npm run publish` → 产出 `dist-static/` 纯静态只读站点
  （数据为 `data/*.json`，无后端、无管理入口、无 AI），整目录丢到 GitHub Pages / Vercel / 任意静态托管即可分享链接。

## 快速开始

```bash
cd "D:\workbuddyxiangmu\数字人文学院图书管理系统"
npm install          # express + cors + better-sqlite3 + multer
npm start            # http://localhost:3000
```

### 创始人口令

口令来自 `.env` 的 `FOUNDER_PASSCODE`（首次启动未配置会自动生成并写回 `.env`，控制台打印一次）。
浏览器打开 `http://localhost:3000/#/manage`（入口是导航栏右侧的「·」）输入口令解锁。

`.env` 示例（见 `.env.example`）：
```ini
FOUNDER_PASSCODE=你的口令
TOKEN_SECRET=一串随机字符串
# LLM_API_URL / LLM_API_KEY / LLM_MODEL  可选：接入真实大模型
```

### 发布静态版

```bash
npm run publish      # 或管理端「发布静态版」按钮
npx serve dist-static   # 本地预览；上线则把 dist-static/ 推到静态托管
```

## 目录结构

```
├─ server/
│  ├─ server.js         # 入口与路由（公开只读 API + /api/manage/* + 上传 + /api/publish）
│  ├─ db.js             # 建表（books/works/posts）与种子数据
│  ├─ manage-auth.js    # 创始人单口令 → HMAC token（限速 5 次/分钟）
│  ├─ publish.js        # 静态导出核心（拷贝 public + 注入 STATIC_MODE 配置 + data/*.json）
│  ├─ ai.js             # AI 馆员智能体（检索/荐书/导读，无借阅）
│  └─ crypto.js         # scrypt 哈希 + token 签名（零依赖）
├─ public/
│  ├─ index.html        # importmap(three) + 四版块 SPA
│  ├─ js/galaxy.js      # 3D 星系（本地 vendor three r160，无 CDN 依赖）
│  ├─ js/{app,views,charts,ai}.js
│  ├─ vendor/           # three.module.min.js / OrbitControls / VRButton
│  ├─ covers/           # 封面（按索书号命名：<索书号>.jpg）
│  ├─ media/            # 管理端上传的作品/资讯文件
│  └─ img/bg-dusk.jpg   # AI 生成的晨昏霞光页面背景
├─ scripts/export-static.js  # CLI 发布
├─ data/library.db      # SQLite（books 696 / works / posts）
└─ docs/
```

## 内容管理（#/manage）

- **摘星辰作品**：星辰代号 / 期数 / 标题 / 简介(支持 Markdown) / 成员 / 类型
  （`html` 交互作品 iframe 沙箱嵌入 · `image` · `video` · `link` 外链）/ 封面 / 标签 / 排序 / 可见性。
- **资讯**：分类（动态/时事/工具/学习资源）/ 标题 / 摘要 / 正文(Markdown) / 封面 / 来源名+原文链接。
- **上传**：`POST /api/manage/upload?kind=img|video|file`（multer，白名单扩展名，存 `public/media/`）。
- **发布**：`POST /api/publish` → `dist-static/`（含 publish-checkpoint.json 发布指纹）。

## AI 馆员「小文」

离线规则引擎跑满全部能力（零 API 零费用），配置 `LLM_API_URL + LLM_API_KEY` 后自动升级为工具增强大模型。

| 能力 | 示例说法 |
|---|---|
| 检索 | 「有没有 Python 入门的书」「鲁迅有什么书」 |
| 推荐 / 相似书 | 「推荐几本书」「跟《乡土中国》类似的书」 |
| 位置 / 馆藏 | 「《乡土中国》在哪」 |
| 导读 | 「介绍一下《乡土中国》」 |
| 平台介绍 | 「摘星辰是什么」「平台有哪些版块」 |
| 多轮追问 | 「换一批」「第 2 本」 |

```bash
node scripts/_ai_agent_test.js      # 22 组问法离线回归
node scripts/_ai_llm_mock_test.js   # mock 大模型工具链路回归
node scripts/_star_layout_test.js   # 2D 星空兜底渲染回归
```

## 书库数据维护

- 重灌馆藏：删 `data/library.db*` → 重启（自动按 `data/seed-books.json` 种子重建）。
- 增量导入：JSON 模板 `public/data/import-template.json`；索书号优先去重，其次 ISBN。
- 封面：把 `<索书号>.jpg` 放进 `public/covers/`；命名规范见 `public/covers/README.txt`。

## 技术要点

- 原生 HTML/CSS/JS SPA（hash 路由），前端零框架；后端仅 4 个 npm 依赖。
- 3D 星系：本地 vendor three.js r160 + OrbitControls；单 draw call 合并馆藏星点；手机端降粒子数；
  `prefers-reduced-motion` 停自动旋转；WebXR 仅在浏览器支持沉浸式会话时出现 VR 按钮。
- 静态发布版通过 `window.STATIC_MODE` 把 `/api/*` GET 映射到 `data/*.json`，路径全部相对化，兼容 GitHub Pages 子路径。
- 主题：晨昏中间调（浅色=暖米纸+暮蓝星空 + AI 生成霞光纹理；深色=暖棕夜色），支持一键切换。
