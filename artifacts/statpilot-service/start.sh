#!/usr/bin/env bash
# StatPilot 体育数据分析服务启动脚本（pm2 兼容）
set -e
cd "$(dirname "$0")"
# 加载 cybertronian-club 根 .env（LLM 密钥等）
if [ -f "../.env" ]; then
  set -a
  . ../.env
  set +a
fi
export STATPILOT_PORT="${STATPILOT_PORT:-5080}"
exec ./.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port "$STATPILOT_PORT"
