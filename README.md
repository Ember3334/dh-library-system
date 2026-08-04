# 数字人文学院图书室 · AI 智能管理系统

为数字人文学院图书室打造的轻量化图书管理系统，同时作为「高校图书馆 AI+管理服务」大赛的参赛底座（v1）。

## 特性
- **轻量零云费用**：前端原生 HTML/CSS/JS（零框架），后端 Node.js + Express + SQLite（单文件数据库）。
- **完整业务**：图书编目 / 检索筛选、借阅审批流（待审批→待取书→借出）、读者管理、数据看板（自绘 Canvas 图表）。
- **知识星空首页**：每本书是一颗星，随机闪烁，点「星尘奇遇」随机邂逅一本书，强化探索感。
- **数字人 AI 助手「小文」**：数字人文专业形象的对话助手，离线规则引擎 / 可一键切真实大模型。
- **公开数据**：图书流动排行榜（最受欢迎 / 冷门 / 借阅之星 / 好评）、数字人文分析版块、读者评论 + AI 情感分析，数据真实、匿名化。
- **三种运行方式**：
  1. 本地开发 `npm start`（Node 服务，http://localhost:3000）。
  2. 双击 HTML 打开：后端部署到 Zeabur/CloudBase 后，在 `public/config.js` 填入远程域名，直接双击 `public/index.html` 即可使用全部功能。
  3. 全栈云部署：前端静态托管 + 后端远程运行，得到一个可分享的 https 网址。
- **容量目标**：SQLite WAL 模式，支撑 ≥2000 读者注册借阅、50 人并发。

## 运行环境
- Node.js ≥ 18（推荐 20+）

## 快速开始
```bash
# 1. 进入项目目录（D 盘）
cd "D:\workbuddyxiangmu\数字人文学院图书管理系统"

# 2. 安装依赖（仅 express + better-sqlite3）
npm install

# 3. 启动
npm start
# 或： node server/server.js

# 4. 浏览器打开
http://localhost:3000
```

## 默认账号
| 角色 | 账号 | 密码 |
|------|------|------|
| 管理员 | `admin` | `admin123` |
| 馆员 | `librarian` | `lib12345` |

读者请在首页「注册」自助创建（默认角色=读者，可借 5 本）。

## 目录结构
```
数字人文学院图书管理系统/
├─ server/              # 后端（Node.js + Express + SQLite）
│  ├─ server.js         # 入口与路由（图书/借阅审批/管理/AI/封面）
│  ├─ db.js             # 数据库初始化、建表、种子数据
│  ├─ auth.js           # 注册/登录/角色鉴权
│  ├─ ai.js             # AI 助手（检索增强 + 规则 + 推荐 + LLM 适配器）
│  └─ crypto.js         # 密码哈希 + token 签名（零依赖）
├─ public/              # 前端（原生 HTML/CSS/JS）
│  ├─ index.html
│  ├─ config.js         # 远程后端域名配置（本地留空，部署时填写）
│  ├─ css/style.css
│  ├─ js/{app,views,charts,ai}.js
│  ├─ covers/           # 书籍封面
│  └─ data/import-template.json
├─ data/                # 运行时数据（库文件 + 种子）
│  ├─ library.db*       # 自动生成
│  └─ seed-books.json
├─ references/          # 馆藏源资料（xlsx/docx/pptx，不入库）
├─ scripts/             # 工具脚本（演示数据/压测/校验）
├─ docs/                # 文档（deploy-simple.md 简单上线 / deployment-guide-2000.md 学院落地）
└─ README.md
```

## 导入真实书目
1. 下载模板：`public/data/import-template.json`（后台「导入」页也可一键下载）。
2. 按字段填入你的真实馆藏（title 必填；category/tags 建议规范填写）。
3. 馆员/管理员进入「导入」页，上传 JSON 或 CSV，选择「仅新增」或「按 ISBN 更新」，提交即可。

字段：`title, author, isbn, publisher, year, category, tags, location, intro, total`

## 接入真实大模型（可选）
在 `server.js` 启动前配置环境变量，AI 助手自动从规则引擎切换为真实 LLM：
```bash
set LLM_API_URL=https://your-endpoint/v1/chat/completions
set LLM_API_KEY=你的密钥
set LLM_MODEL=gpt-3.5-turbo
node server.js
```
未配置时，AI 助手使用内置的检索增强与规则问答，完全免费离线运行。

## 压测 / 演示数据（可选）
```bash
node scripts/seed-test.js        # 生成 2000 测试读者 + 800 条借阅
node scripts/seed-test.js clean  # 清除上述测试数据
```

## 部署上线（无需本地运行）
详见 `docs/deploy-simple.md`，包含：
- 双击 `index.html` + 远程后端的配置方法
- Zeabur 一键部署全栈（免费额度足够比赛演示）
- CloudBase 国内 2000 人长期落地方案及费用估算

核心配置只需改 `public/config.js`：
```js
// 本地开发保持空字符串
window.API_BASE = '';

// 远程部署示例（Zeabur/CloudBase 给你的域名）
// window.API_BASE = 'https://your-app.zeabur.app';
```

## 后续（比赛材料）
申报书 / 建设说明书 / 展示视频等，在系统基础上单独补充。
