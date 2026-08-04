# 数字人文学院图书管理系统 · 2000 人级真正落地部署方案

> 本文档面向学院信息中心与图书馆管理员，说明如何把当前参赛原型系统扩展为可支撑 2000 名师生日常使用的生产级服务。

---

## 一、现状与目标

| 维度 | 当前原型 | 2000 人生产目标 |
|------|----------|----------------|
| 用户数 | 演示账号 + 种子读者 | 2000 名师生 |
| 并发 | 设计目标 50 并发 | 峰值 150~300 并发 |
| 数据库 | SQLite（文件型） | PostgreSQL / MySQL（服务型） |
| 部署 | 单机 `node server.js` | 服务器 + 反向代理 + 容器化 |
| 认证 | 本地账号 | 对接学院统一身份认证（CAS/OAuth2/企业微信） |
| 运维 | 手动重启 | 自动备份 + 监控 + 日志 |

---

## 二、硬件与网络建议

### 2.1 最小生产配置

| 组件 | 配置 | 数量 | 说明 |
|------|------|------|------|
| 应用服务器 | 4 核 8G / 100G SSD | 1~2 台 | 运行 Node.js + 静态资源 |
| 数据库服务器 | 4 核 8G / 200G SSD | 1 台 | PostgreSQL 主库 |
| 反向代理 | Nginx / Caddy | 与应用同机或独立 | HTTPS、负载均衡、静态缓存 |
| 备份存储 | NAS / 对象存储 | 1 份 | 每日全量备份 + WAL 增量 |

### 2.2 网络要求

- 内网部署：建议部署在学院内网，师生通过校园网或 VPN 访问。
- 域名 + HTTPS：申请学院二级域名（如 `lib.dh.xxx.edu.cn`），使用学院证书或 Let's Encrypt。
- 端口：外网仅开放 443，内网开放 22（运维）、5432（数据库仅限内网）。

---

## 三、软件架构升级

### 3.1 数据库：SQLite → PostgreSQL

原型的 `better-sqlite3` 在并发写入时会出现锁竞争。2000 人场景建议迁移到 PostgreSQL：

1. **迁移脚本**：导出 SQLite → 导入 PostgreSQL
   ```bash
   # 1. 安装 pgloader
   pgloader sqlite:///path/to/library.db postgresql://user:pass@localhost/dhlib
   ```
2. **连接池**：后端改用 `pg` + `connection pool`
   ```js
   const { Pool } = require('pg');
   const pool = new Pool({ host: 'localhost', database: 'dhlib', max: 20 });
   ```
3. **索引优化**：在 `borrows(book_id, status)`、`comments(book_id)`、`books(category)` 上建复合索引。

### 3.2 应用层改造

- **ORM/查询层**：将 `better-sqlite3` 的同步查询改为 `pg` 的异步查询，避免阻塞事件循环。
- **文件存储**：封面图片从本地 `public/covers/` 迁移到对象存储（MinIO / 学院 NAS / 阿里云 OSS），数据库只存 URL。
- **Session / Token**：继续使用 JWT，但设置较短的 access token 有效期（如 2 小时），并引入 refresh token 机制。

### 3.3 静态资源与缓存

- Nginx 托管 `public/` 目录，并开启 gzip/brotli 压缩。
- 封面图、JS/CSS 设置长期缓存（30 天）。
- API 响应使用 `Cache-Control: no-cache`（数据需实时），但可针对 `/api/rankings`、`/api/dh` 等计算密集接口做 5 分钟 Redis 缓存。

---

## 四、安全加固

### 4.1 身份认证

- **统一身份认证**：对接学院 CAS / OAuth2 / 企业微信，读者首次登录自动创建账号。
- **管理员/馆员**：仍由系统管理员手工授权，不开放自助注册管理角色。
- **密码策略**：若保留本地账号，强制 8 位以上 + 数字字母组合。

### 4.2 权限与审计

- 敏感接口（审批、删除、修改额度）记录操作日志表 `operation_logs(user_id, action, target, ip, time)`。
- 读者隐私：排行榜、借阅动态中读者姓名必须匿名化（已在前端实现）。
- SQL 注入防护：全部使用参数化查询（当前已做到）。

### 4.3 HTTPS 与 Headers

Nginx 配置示例：
```nginx
server {
  listen 443 ssl http2;
  server_name lib.dh.xxx.edu.cn;
  ssl_certificate /etc/nginx/ssl/lib.crt;
  ssl_certificate_key /etc/nginx/ssl/lib.key;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
  location /covers/ {
    alias /var/lib/dhlib/covers/;
    expires 30d;
  }
}
```

---

## 五、部署流程（推荐 Docker + docker-compose）

### 5.1 目录结构

```
/opt/dhlib/
├── docker-compose.yml
├── app/                  # 当前项目代码
├── data/
│   ├── postgres/         # 数据库持久化
│   ├── covers/           # 封面图
│   └── backups/          # 每日备份
└── nginx/
    ├── nginx.conf
    └── ssl/
```

### 5.2 docker-compose.yml 示例

```yaml
version: '3.8'
services:
  app:
    build: ./app
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://dhlib:password@db:5432/dhlib
      - PORT=3000
    volumes:
      - /opt/dhlib/data/covers:/app/public/covers
    depends_on:
      - db
    restart: always

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=dhlib
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=dhlib
    volumes:
      - /opt/dhlib/data/postgres:/var/lib/postgresql/data
    restart: always

  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
    volumes:
      - /opt/dhlib/nginx/nginx.conf:/etc/nginx/conf.d/default.conf
      - /opt/dhlib/nginx/ssl:/etc/nginx/ssl
    depends_on:
      - app
    restart: always
```

### 5.3 上线步骤

1. 准备服务器、域名、SSL 证书。
2. 安装 Docker + docker-compose。
3. 复制项目代码到 `/opt/dhlib/app/`，调整数据库连接。
4. 导入真实馆藏数据（沿用现有 JSON/CSV 导入功能）。
5. 启动服务：`docker-compose up -d`
6. 配置 Nginx HTTPS。
7. 配置自动备份脚本（见第六节）。

---

## 六、备份与灾难恢复

### 6.1 备份策略

| 类型 | 频率 | 保留周期 | 工具 |
|------|------|----------|------|
| 数据库全量 | 每日 02:00 | 30 天 | `pg_dump` |
| WAL 增量 | 实时归档 | 7 天 | PostgreSQL PITR |
| 封面文件 | 实时同步 | 30 天 | `rsync` / 对象存储 |
| 配置文件 | 变更时 | 长期 | Git |

### 6.2 自动备份脚本

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -h localhost -U dhlib dhlib | gzip > /opt/dhlib/data/backups/dhlib_${DATE}.sql.gz
find /opt/dhlib/data/backups -name "dhlib_*.sql.gz" -mtime +30 -delete
rsync -av /opt/dhlib/data/covers/ backup-server:/backups/dhlib/covers/
```

### 6.3 恢复演练

- 每学期至少一次恢复演练。
- RTO（恢复时间目标）< 2 小时；RPO（数据丢失目标）< 1 小时。

---

## 七、性能优化

### 7.1 数据库

- 为高频查询加索引（已部分存在）：
  ```sql
  CREATE INDEX idx_borrows_status_book ON borrows(status, book_id);
  CREATE INDEX idx_borrows_user_active ON borrows(user_id) WHERE status IN ('待审批','待取书','借出','逾期');
  ```
- 定时任务：每日凌晨标记逾期、生成统计缓存。

### 7.2 应用

- Node.js 集群模式：`pm2 start server.js -i max` 或容器多副本。
- Redis 缓存排行榜、数字人文分析结果（5 分钟刷新）。
- 图片压缩：上传封面时自动生成缩略图（避免原图 8MB 直传）。

### 7.3 前端

- 星空页对 696 本书同时渲染，在低端设备上可能卡顿。可限制只渲染可视区星星或按分类分批加载。
- 启用 Service Worker 离线缓存（已实现）。

---

## 八、监控与运维

### 8.1 日志

- 应用日志输出到文件并按天轮转（`winston` / `pino`）。
- Nginx access log 保留 30 天。
- 错误日志接入学院日志平台或企业微信告警。

### 8.2 监控指标

| 指标 | 告警阈值 | 工具 |
|------|----------|------|
| CPU > 80% 持续 5min | 告警 | Prometheus + Grafana |
| 内存 > 85% | 告警 | Prometheus + Grafana |
| 磁盘 > 80% | 告警 | Prometheus + Grafana |
| 5xx 错误数 > 10/分钟 | 告警 | Nginx log + Alertmanager |
| 数据库连接数 > 80% | 告警 | PostgreSQL exporter |
| 备份失败 | 立即告警 | 备份脚本返回值 |

### 8.3 值班与升级

- 建立每学期值班表。
- 紧急问题联系方式公示在系统页脚。

---

## 九、数据治理与内容运营

### 9.1 数据质量

- 封面：批量补充真实封面，命名规则 `/covers/<索书号>.jpg`。
- 标签：馆员为每本书补充 3~5 个标签，提升 AI 荐书和数字人文分析精度。
- 简介：利用真实大模型批量生成导读，人工审核后入库。

### 9.2 隐私与合规

- 借阅记录保存期限：毕业后 2 年匿名化或删除。
- 评论内容需 moderation：馆员可后台隐藏不当评论。
- 公开排行榜必须匿名化（已实现 `maskName`）。

---

## 十、用户培训与推广

### 10.1 分阶段上线

| 阶段 | 时间 | 范围 | 目标 |
|------|------|------|------|
| 内测 | 第 1~2 周 | 馆员 + 志愿者 50 人 | 修复 bug、完善数据 |
| 公测 | 第 3~4 周 | 数字人文学院师生 500 人 | 收集反馈、优化性能 |
| 全院上线 | 第 5~6 周 | 2000 人 | 正式运行 |

### 10.2 培训内容

- 读者：检索、申请借阅、查看审批状态、评论、使用 AI 助手。
- 馆员：审批、到馆取书确认、归还、编目、导入、数据看板。
- 管理员：账号管理、权限配置、备份恢复、监控告警。

### 10.3 推广物料

- 制作 1 分钟使用短视频。
- 在图书室张贴二维码海报。
- 新生入学教育中加入系统介绍。

---

## 十一、与学院生态对接

| 系统 | 对接方式 | 价值 |
|------|----------|------|
| 统一身份认证 | CAS / OAuth2 | 免注册登录 |
| 企业微信 / 钉钉 | Webhook | 借阅到期提醒、审批通知 |
| 学院官网 | iframe / 链接 | 入口整合 |
| 图书馆 OPAC | 数据同步 | 避免重复录入 |
| 学习通 / 雨课堂 | API | 课程推荐阅读 |

---

## 十二、成本估算（参考）

| 项目 | 自采服务器 | 云服务器（阿里云/腾讯云） |
|------|------------|--------------------------|
| 应用服务器 | 0（复用） | ¥300~600/月 |
| 数据库服务器 | 0（复用） | ¥200~400/月 |
| 对象存储 | 0（NAS） | ¥50~100/月 |
| SSL 证书 | 0（Let's Encrypt） | 0 |
| 大模型 API | 可选，离线可用 | 按量，约 ¥0~200/月 |
| 合计（首年） | ¥0~5000（硬件折旧） | ¥6000~13000 |

> 如果学院已有虚拟化平台，可直接复用，**零新增云费用**。

---

## 十三、检查清单（上线前必做）

- [ ] 数据库已迁移至 PostgreSQL 并完成压力测试
- [ ] HTTPS 证书已配置并强制跳转
- [ ] 统一身份认证对接完成
- [ ] 封面图已批量上传并备份
- [ ] 自动备份脚本已测试并可恢复
- [ ] 监控告警已配置并触发测试
- [ ] 操作审计日志已启用
- [ ] 管理员和馆员培训已完成
- [ ] 用户协议与隐私声明已上线
- [ ] 灾难恢复演练已完成

---

## 十四、结语

当前原型已经覆盖了核心业务流程（借阅审批、AI 助手、数据可视化、评论、排行榜）。真正落地时，最关键的是 **数据库升级、HTTPS + 统一认证、自动备份、监控告警** 四项。建议以 Docker 方式部署，先在内测阶段跑稳，再逐步扩大到 2000 人规模。
