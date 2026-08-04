# 上线部署指南：从"本地运行"到"打开网址即看"

> 目标：不再依赖 `localhost:3000`，让别人通过网址或双击 HTML 文件就能看到完整系统。

---

## 一、这次代码改了什么（你已经可以部署了）

为了让前端既能本地运行，也能作为静态文件打开并连接远程后端，我做了以下改造：

1. **新增 `public/config.js`**：只改这里一个文件，就能切换后端地址。
   ```js
   window.API_BASE = '';                 // 本地开发保持空字符串
   // window.API_BASE = 'https://你的域名'; // 远程部署时启用
   ```
2. **后端开启 CORS**：`server.js` 已加入跨域支持，允许 `file://` 本地文件、GitHub Pages、静态托管站点调用后端接口。
3. **前端接口与封面路径全部使用 `window.API_BASE`**：所有 `/api/...`、`/covers/...` 都会自动拼接远程域名。
4. **首页资源改为相对路径**：CSS/JS/图片都改用 `./` 开头，双击 `index.html` 也能加载样式和脚本。

也就是说：**你现在有三种方式让别人看到你的系统**：

| 方式 | 是否需要后端 | 操作难度 | 适合场景 |
|------|-------------|---------|---------|
| **A. 双击 HTML + 远程后端** | 是（后端已部署） | 极低 | 比赛答辩、给评委演示 |
| **B. Zeabur 一键部署全栈** | 是（前后端一起部署） | 低 | 长期在线、分享链接 |
| **C. CloudBase 国内 2000 人落地** | 是（云函数+云数据库） | 中 | 真正给学院师生使用 |

---

## 二、方式 A：双击 HTML 文件打开（最简单，5 分钟）

适用于：你已经把后端部署到 Zeabur/CloudBase，但希望本地留个"离线可打开的入口"。

### 步骤

1. **先把后端按方式 B 部署到 Zeabur**，得到一个网址，例如：
   ```
   https://dh-library-demo.zeabur.app
   ```
2. **打开 `public/config.js`**，填入上面的域名：
   ```js
   window.API_BASE = 'https://dh-library-demo.zeabur.app';
   window.STATIC_BASE = 'https://dh-library-demo.zeabur.app';
   ```
3. **直接双击 `public/index.html`**，浏览器会打开 `file:///.../index.html`，页面会自动从远程后端拉取 696 本书、登录、借阅、评论、AI 全部可用。

> ⚠️ 注意：封面图片走远程后端的 `/covers/` 路径，如果远程后端没有上传封面，会显示自动生成的设计感占位封面（已有逻辑）。

---

## 三、方式 B：Zeabur 一键部署全栈（推荐，比赛/分享）

Zeabur 是一个香港/台湾团队做的 PaaS 平台，对中文用户友好，支持 Node.js 一键部署，**免费额度足够跑本项目**。

### 费用（2026 年 8 月）

| 项目 | 免费额度 | 付费起步 | 是否推荐 |
|------|---------|---------|---------|
| Zeabur Free | **$5/月 compute credits**，无需信用卡 | $0 | ✅ 比赛/演示首选 |
| Zeabur Dev | $5/月平台费 + 资源费 | ~$5/月起 | 需要日志保留 7 天、备份时 |
| Zeabur Pro | $19/月 | ~$19/月起 | 团队协作/长期项目 |

> 本项目是轻量 Node.js + SQLite，**免费额度 $5/月足够长期运行一个实例**。额度用完后服务会暂停（数据保留），下个月自动恢复。

### 部署步骤（图文级，按当前 Zeabur 界面）

1. **准备 GitHub 仓库**
   - 本项目已推送到 `https://github.com/Ember3334/dh-library-system.git`，可跳过。

2. **注册/登录 Zeabur**
   - 打开 https://zeabur.com
   - 用 GitHub 账号一键登录。

3. **创建项目（不要进「服务器/Server」页面）**
   - 登录后看**左侧边栏**，点 **「项目 / Projects」**（图标像文件夹，不是「服务器」）。
   - 在项目列表页点 **「创建项目 / Create Project」**。
   - 项目类型选 **「共享集群 / Shared Cluster」**（这是免费的；不要选「购买服务器」或「连接自己的集群」）。
   - 如果当前界面只有「购买集群 / 连接自己的集群」两个选项，说明你的账号/地区默认进入了「创建服务器」弹窗，**点右上角 X 关闭它**，回到左侧栏重新进「项目」。

4. **从 GitHub 部署服务**
   - 进入项目后，点 **「部署新服务 / Deploy New Service」**。
   - 选择 **GitHub** → 找到并勾选 `Ember3334/dh-library-system` → 点 **Connect / 连接**。
   - Zeabur 会自动识别 `package.json` 的 `start` 脚本（`node server/server.js`）并构建。

5. **生成公开域名**
   - 部署成功后，进入服务详情 → **Domains**（域名）。
   - 点 **Generate Domain**，会得到类似：
     ```
     https://dh-library-demo.zeabur.app
     ```

6. **访问系统**
   - 直接打开上面的网址，即可看到完整系统。
   - 管理员：`admin / admin123`，馆员：`librarian / lib12345`。

7. **（可选）绑定自己的域名**
   - 在 Domains 里点 **Add Custom Domain**，按提示添加 CNAME 记录即可，SSL 自动配置。

### 如果 Zeabur 始终要求买服务器 / 没有共享集群入口

Zeabur 2026 年的界面在某些账号或地区下会先让你创建/购买集群。如果按上面步骤找不到「共享集群」，就直接换 **Render**（完全免费、无信用卡、对 Node.js 最友好）：

1. 打开 https://render.com 并用 GitHub 登录。
2. 控制台右上角点 **+ New → Web Service**。
3. 选择 `Ember3334/dh-library-system` 仓库，点 **Connect**。
4. 配置：
   - Name：随便，如 `dh-library-system`
   - Runtime：Node
   - Build Command：`npm install`
   - Start Command：`npm start`
   - Instance Type：**Free**
5. 点 **Create Web Service**，等 2–3 分钟，得到 `https://dh-library-system.onrender.com`。
6. 把这个地址填进 `public/config.js` 的 `API_BASE` 和 `STATIC_BASE`，即可双击 `index.html` 使用。

> Render Free 的缺点是 15 分钟无访问会自动休眠，首次打开要等待 30 秒左右「唤醒」。比赛演示时先访问一次即可。

### 注意事项

- **SQLite 持久化**：Zeabur Free 的容器磁盘在重启后可能清空。比赛演示没问题；如果要长期保留数据，建议：
  - 方式 1：定期导出数据库备份。
  - 方式 2：升级到付费持久磁盘。
  - 方式 3：按方式 C 迁移到 CloudBase 云数据库。

---

## 四、方式 C：CloudBase 国内 2000 人长期落地

如果最终目标是给数字人文学院 2000 名师生稳定使用，且要求国内访问速度快，推荐 **腾讯云 CloudBase**。

### 费用（2026 年 8 月）

| 项目 | 免费额度 | 超出后费用 | 说明 |
|------|---------|-----------|------|
| CloudBase 环境 | **1 个免费环境/账号，3000 资源点/月** | 按量计费 | 新账号足够起步 |
| 静态网站托管 | 按流量/容量 | 低 | 前端放这里 |
| 云托管 CloudRun | 按容器规格和运行时长 | 约 ¥0.05/GB·小时起 | 后端放这里 |
| 云数据库 MySQL | 按容量/请求 | 约 ¥0.1/GB·月起 | 替代 SQLite |
| 云存储 | 按容量/流量 | 低 | 封面图片可放这里 |

> 实际给 2000 人使用时，预计月费在 **¥30–100** 区间（取决于活跃度和图片存储量），学生项目可申请腾讯云"云+校园"等学生优惠进一步降低。

### 部署架构

```
用户浏览器
    ↓
CloudBase 静态网站托管（public/ 目录）
    ↓ 调用 API
CloudBase 云托管 / 云函数（server/ 后端）
    ↓ 读写
CloudBase MySQL（替代 SQLite）
```

### 迁移要点

1. **数据库迁移**：把 `data/library.db` 导出为 SQL，导入 CloudBase MySQL。
2. **后端适配**：将 `server/server.js` 中的 SQLite 查询改为 MySQL 查询（可用 `mysql2` 包），或直接部署为 CloudRun 容器保留 SQLite（不推荐长期用）。
3. **前端部署**：把 `public/` 目录上传到 CloudBase 静态托管，修改 `config.js` 中的 `API_BASE` 为云托管域名。
4. **域名备案**：如果绑定自己的 `.cn`/`.com` 域名，需要 ICP 备案；使用学校域名可由学校统一备案。

> 详细迁移步骤见 `docs/deployment-guide-2000.md`。

---

## 五、三种方式费用对比总表

| 平台 | 月费（演示期） | 月费（2000 人） | 国内速度 | 学习成本 | 推荐阶段 |
|------|---------------|-----------------|---------|---------|---------|
| **Zeabur Free** | **$0** | 不适合 | 快（香港/新加坡） | 极低 | 比赛演示、分享链接 |
| **CloudBase 免费环境** | **¥0–30** | ¥30–100 | 极快 | 中 | 国内长期运行 |
| **Render Free** | **$0** | 不适合 | 较慢（美西） | 低 | 海外访问/备选 |
| **GitHub Pages 纯静态** | **$0** | 无后端 | 快 | 极低 | 只展示界面，无交互 |

---

## 六、最终推荐

- **现在（比赛/演示）**：用 **Zeabur Free**，5 分钟出网址，0 费用，国内访问流畅。
- **比赛前给评委展示**：用 **方式 A（双击 HTML + Zeabur 后端）**，评委无需装任何环境，打开文件即用。
- **学院 2000 人真正落地**：用 **CloudBase**，迁移到 MySQL，月费可控，国内速度快。

**你现在就可以开始**：先注册 Zeabur → 推 GitHub 仓库 → 拿到网址 → 填入 `public/config.js` → 双击 `index.html` 验证。
