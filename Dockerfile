# 使用 Debian 版 Node（含 gcc/make/python3，可编译 better-sqlite3 原生模块）
FROM node:18-bullseye

WORKDIR /app

# 先装依赖（利用 Docker 缓存层）
COPY package*.json ./
RUN npm install --omit=dev

# 复制项目源码
COPY . .

# 确保 data 目录存在（SQLite 运行时创建）
RUN mkdir -p /app/data

# 服务监听端口（CloudBase 服务端口填 3000）
EXPOSE 3000

CMD ["npm", "start"]
