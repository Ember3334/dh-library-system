# 上线部署指南：从"本地运行"到"打开网址即看"

> 目标：不再依赖 `localhost:3000`，让别人通过网址或双击 HTML 文件就能看到完整系统。
> 更新说明（2026-08-04）：Render / Zeabur / Railway 等平台虽然提供免费实例，但目前新账号/部分地区要求绑定信用卡才能创建服务，**不适合没有信用卡的学生**。本文已按「0 信用卡、可长期使用」重新排序推荐方案。

---

## 一、这次代码改了什么（你已经可以部署了）

为了让前端既能本地运行，也能作为静态文件打开并连接远程后端，我做了以下改造：

1. **新增 `public/config.js`**：只改这里一个文件，就能切换后端地址。
   ```js
   window.API_BASE = '';                 // 本地开发保持空字符串
   // window.API_BASE = 'https://你的域名'; // 远程部署时启用
   ```
2. **后端开启 CORS**：`server.js` 已加入跨域支持，允许 `file://` 本地文件、GitHub Pages、静态托管站点调用后端接口（含登录用的 `Authorization` 头）。
3. **前端接口与封面路径全部使用 `window.API_BASE`**：所有 `/api/...`、`/covers/...` 都会自动拼接远程域名。
4. **首页资源改为相对路径**：CSS/JS/图片都改用 `./` 开头，双击 `index.html` 也能加载样式和脚本。

也就是说：**你现在有三种方式让别人看到你的系统**：

| 方式 | 是否需要后端 | 操作难度 | 适合场景 |
|------|-------------|---------|---------|
| **A. 双击 HTML + 远程后端** | 是（后端已部署） | 极低 | 比赛答辩、给评委演示 |
| **B. CloudBase 免费环境部署** | 是（云托管容器） | 中 | 国内长期运行、真正给学院用 |
| **C. Replit 免费部署** | 是（在线容器） | 低 | 零信用卡、快速给海外/小众展示 |

---

## 二、方式 A：双击 HTML 文件打开（最简单，5 分钟）

适用于：你已经把后端部署到 CloudBase/Replit，希望本地留个「离线可打开的入口」。

### 步骤

1. **先把后端按方式 B 或 C 部署出去**，得到一个网址，例如：
   ```
   https://dh-library-system-xxx.cloudbase.app
   ```
2. **打开 `public/config.js`**，填入上面的域名：
   ```js
   window.API_BASE = 'https://dh-library-system-xxx.cloudbase.app';
   window.STATIC_BASE = 'https://dh-library-system-xxx.cloudbase.app';
   ```
3. **直接双击 `public/index.html`**，浏览器会打开 `file:///.../index.html`，页面会自动从远程后端拉取 696 本书，登录、借阅、评论、AI 全部可用。

> ⚠️ 注意：封面图片走远程后端的 `/covers/` 路径，如果远程后端没有上传封面，会显示自动生成的设计感占位封面（已有逻辑）。

---

## 三、方式 B：腾讯云 CloudBase 免费环境（国内推荐，0 信用卡）

> 核心优势：国内访问快、新账号可创建 **1 个长期免费体验环境（3000 资源点/月）**、只需身份证实名认证、**不需要信用卡**。演示期几乎 0 费用，给学院 2000 人长期用也只需平滑升级到付费套餐。

### 费用（2026 年 8 月，来自腾讯云官方文档）

| 项目 | 免费额度 | 超出后费用 | 说明 |
|------|---------|-----------|------|
| **CloudBase 免费体验环境** | **3000 资源点/月** | 不允许超（需升级付费环境） | 新账号可创建 1 个，长期有效，可续期 |
| 云托管 CloudRun | 包含在环境资源点内 | 约 55 点/核·小时 + 32 点/GB·小时 | 跑 Node.js 后端 |
| 静态网站托管 | 1 GB 存储免费 | 按容量/流量 | 前端 `public/` 放这里 |
| 云数据库 MySQL | 免费环境暂不支持 | 升级后约 ¥0.1/GB·月起 | 长期 2000 人落地时迁移 |

> 换算：1000 资源点 = 0.1 元。3000 点/月 ≈ 0.3 元等值资源，对轻量演示完全够用。

### 部署架构

```
用户浏览器
    ↓
CloudBase 静态网站托管（public/ 目录）
    ↓ 调用 API
CloudBase 云托管 / 云函数（server/ 后端）
    ↓ 读写
容器内 SQLite（演示期） → 后期迁移到 CloudBase MySQL
```

### 详细部署步骤

#### 1. 注册与实名认证

1. 打开 https://cloud.tencent.com
2. 用微信/QQ/邮箱注册腾讯云账号。
3. 进入 **控制台 → 账号信息 → 实名认证**。
4. 选择「个人认证」，上传身份证正反面，完成人脸识别。
   > 这是国内云服务的合规要求，**不需要绑定信用卡/银行卡**即可使用免费额度。

#### 2. 创建 CloudBase 免费体验环境

1. 进入 **云开发 CloudBase 控制台**：https://console.cloud.tencent.com/tcb
2. 点击 **「新建环境」**。
3. 在套餐选择页，找到 **「免费体验版」**（或「免费体验环境」），点 **「立即创建」**。
   - 套餐说明：3000 资源点/月，1 个环境，可续期。
4. 等待环境初始化完成（约 1–2 分钟）。

#### 3. 部署后端到「云托管 CloudRun」

> 推荐用「上传代码包」方式，学习成本最低。

1. 在本地项目根目录，把后端相关文件打包（不要包含 `node_modules`、`data/*.db`、`.git`）：
   ```bash
   cd D:/workbuddyxiangmu/数字人文学院图书管理系统
   #  Windows PowerShell 示例
   Compress-Archive -Path server,package.json,public,data -DestinationPath dh-library-deploy.zip
   ```
2. 回到 CloudBase 控制台，进入刚创建的环境。
3. 左侧菜单选择 **云托管 → 服务列表 → 新建服务**。
4. 填写服务信息：
   - 服务名称：`dh-library-system`
   - 地域：选离你最近的（如广州/上海）
   - 流量策略：100%（默认）
5. 选择 **「新建版本」** → **「通过代码包上传」** → 上传刚才的 `dh-library-deploy.zip`。
6. 填写构建与启动命令：
   - 构建命令：`npm install`
   - 启动命令：`npm start`
   - 监听端口：`3000`
7. 实例规格：选 **最小规格**（0.25 核 / 0.5 GB 内存即可，免费额度内）。
8. 点 **开始部署**，等待 3–5 分钟。
9. 部署成功后，服务详情页会显示访问地址，例如：
   ```
   https://dh-library-system-xxx.cloudbaseapp.cn
   ```

> ⚠️ 云托管的容器重启后，SQLite 文件可能丢失。**比赛演示没问题**；若要长期保留数据，建议定期导出 `data/library.db` 备份，或参考 `docs/deployment-guide-2000.md` 迁移到 CloudBase MySQL。

#### 4. 部署前端到「静态网站托管」

1. 在 CloudBase 控制台，左侧菜单选 **静态网站托管 → 开通**（按提示操作）。
2. 进入静态托管后，点 **「上传文件/文件夹」**。
3. 上传 `public/` 目录下的所有内容（`index.html`、`css/`、`js/`、`covers/`、`config.js` 等）。
4. 上传完成后，静态托管会给你一个默认域名，例如：
   ```
   https://dh-library-static-xxx.cloudbaseapp.cn
   ```
5. 打开你上传的 `config.js`，把 `API_BASE` 和 `STATIC_BASE` 改成云托管域名：
   ```js
   window.API_BASE = 'https://dh-library-system-xxx.cloudbaseapp.cn';
   window.STATIC_BASE = 'https://dh-library-system-xxx.cloudbaseapp.cn';
   ```
6. 保存后重新上传 `config.js`。

#### 5. 访问系统

- 直接打开静态托管域名：`https://dh-library-static-xxx.cloudbaseapp.cn`
- 管理员：`admin / admin123`
- 馆员：`librarian / lib12345`

#### 6. 绑定自己的域名（可选）

- 在静态托管和云托管的「域名管理」里添加自定义域名。
- 如果域名是 `.cn`/`.com` 等国内可解析域名，需要 **ICP 备案**。
- 如果只是比赛/演示，用 CloudBase 默认域名即可，无需备案。

---

## 四、方式 C：Replit 免费部署（备选，0 信用卡）

> 如果你不想做国内实名认证，或者想 5 分钟快速上线给少数人看，可以用 Replit。

### 费用与限制（2026 年 8 月）

| 项目 | 免费 Starter | 说明 |
|------|-------------|------|
| 价格 | **$0** | 不需要信用卡 |
| 资源 | 0.5 vCPU / 1 GB RAM / 2 GB 存储 | 够跑本项目 |
| 发布数量 | **1 个 App** | 免费账号只能发布 1 个 |
| 休眠 | 5 分钟无访问会 sleep | 首次访问需等待 10–30 秒唤醒 |
| 代码可见性 | 公开 | 免费版项目公开 |

### 部署步骤

1. 打开 https://replit.com，用 GitHub 账号登录。
2. 点击 **Create → Import from GitHub**。
3. 粘贴仓库地址：`https://github.com/Ember3334/dh-library-system.git`
4. Replit 会自动识别为 Node.js 项目。
5. 在 `.replit` 或运行配置里确保启动命令是 `npm start`。
6. 点击顶部 **Run**，等待依赖安装。
7. 运行后，右侧会显示一个 URL，例如：
   ```
   https://dh-library-system.yourname.repl.co
   ```
8. 打开 `public/config.js`，填入该 URL：
   ```js
   window.API_BASE = 'https://dh-library-system.yourname.repl.co';
   window.STATIC_BASE = 'https://dh-library-system.yourname.repl.co';
   ```
9. 把 `public/` 目录作为静态网站单独部署，或直接把 Replit URL 发给对方，在浏览器打开。

> 注意：Replit 免费版冷启动慢，且项目公开。比赛演示前一定要先访问一次「唤醒」实例。

---

## 五、为什么不推荐 Render / Zeabur / Railway？

| 平台 | 问题 | 结论 |
|------|------|------|
| **Render** | Free 实例在点击 Deploy 时会弹出「Add Card」要求绑定信用卡 | ❌ 不适合学生 |
| **Zeabur** | 部分地区/新账号没有「共享集群」入口，只能购买/连接服务器 | ❌ 对你的账号不可用 |
| **Railway** | 2023 年 8 月起，即使 Free Trial 也要绑定信用卡 | ❌ 不适合学生 |
| **Cyclic** | 已于 2024 年 5 月关闭免费托管服务 | ❌ 已不可用 |

---

## 六、三种可用方案费用对比总表

| 平台 | 月费（演示期） | 月费（2000 人） | 国内速度 | 学习成本 | 推荐阶段 |
|------|---------------|-----------------|---------|---------|---------|
| **CloudBase 免费体验环境** | **¥0** | ¥30–100（升级后） | 极快 | 中 | **国内长期运行首选** |
| **Replit Starter** | **$0** | 不适合 | 一般 | 低 | 零信用卡、快速展示 |
| **GitHub Pages 纯静态** | **$0** | 无后端 | 快 | 极低 | 只展示界面，无交互 |

---

## 七、最终推荐

- **现在（比赛/演示，不想花钱、不想绑卡）**：用 **CloudBase 免费体验环境**，身份证实名后即可部署，国内访问快。
- **比赛前给评委展示**：用 **方式 A（双击 HTML + CloudBase 后端）**，评委无需装任何环境，打开文件即用。
- **学院 2000 人真正落地**：继续用 **CloudBase**，把 SQLite 迁移到 CloudBase MySQL，升级到个人版/标准版，月费可控。
- **如果你连国内实名都不想弄**：用 **Replit**，但接受冷启动慢和项目公开的限制。

**你现在就可以开始**：注册腾讯云 → 实名认证 → 创建 CloudBase 免费环境 → 按步骤 3 部署后端 → 拿到网址 → 填入 `public/config.js` → 双击 `index.html` 验证。
