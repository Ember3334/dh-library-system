#!/usr/bin/env bash
# 数文拾光 · 数字人文平台 — macOS / Linux 一键启动
set -u
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  [错误] 未检测到 Node.js，请先安装 18 或更高版本：https://nodejs.org"
  echo ""
  exit 1
fi

exec node scripts/launch.js
