"""StatPilot 体育数据分析 Agent — FastAPI 服务入口。

架构：Python 微服务（数据管道 + 计算 + 图表 + AI 层），
由 Cybertron Express 以 /api/statpilot/* 代理转发（同源、复用鉴权）。
"""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import nba, nfl, ai
from charts import health as charts_health

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("statpilot")

# 与 cybertronian-club 根 .env 联动；服务启动时已 source
PORT = int(os.environ.get("STATPILOT_PORT", "5080"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("StatPilot service starting on :%s", PORT)
    yield
    logger.info("StatPilot service stopped")


app = FastAPI(title="StatPilot 体育数据分析", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(nba.router, prefix="/nba", tags=["NBA"])
app.include_router(nfl.router, prefix="/nfl", tags=["NFL"])
app.include_router(ai.router, prefix="/ai", tags=["AI"])


@app.get("/health")
def health():
    return {"ok": True, "service": "statpilot", "nba": nba.health(), "nfl": nfl.health(), "charts": charts_health()}
