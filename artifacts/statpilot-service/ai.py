"""AI 层 — Query Planner（中文 → 函数调用）+ Analyst（数据 → 中文解读）。

LLM 使用 DeepSeek（OpenAI 兼容），密钥从环境变量读取：
- LLM_BASE_URL（默认 https://api.deepseek.com/v1）
- LLM_MODEL（默认 deepseek-chat）
- DEEPSEEK_API_KEY / OPENAI_API_KEY
"""
import json
import logging
import os
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("statpilot.ai")

router = APIRouter()

BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com/v1")
MODEL = os.environ.get("LLM_MODEL", "deepseek-chat")
API_KEY = os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""

# ---------- 数据函数注册表（Planner 可调用的工具） ----------

def _fn_nba_shooting(player: str, season: int = 2026) -> dict:
    import nba
    hits = nba.search_players(player, limit=1)
    if not hits:
        raise ValueError(f"找不到球员: {player}")
    pid = hits[0]["id"]
    data = nba.player_shooting(pid, season=season)
    import charts
    data["chartBase64"] = charts.nba_shooting(data["name"], data["team"], season, data)
    return data


def _fn_nba_season(player: str, season: int = 2026) -> dict:
    import nba
    hits = nba.search_players(player, limit=1)
    if not hits:
        raise ValueError(f"找不到球员: {player}")
    return nba.player_season_stats(hits[0]["id"], season=season)


def _fn_nba_game(game_id: str) -> dict:
    import nba
    data = nba.game_boxscore(game_id)
    import charts
    data["chartBase64"] = charts.nba_game_linescore(data["name"], data["linescore"])
    return data


def _fn_nfl_receiving(player: str, season: int = 2025) -> dict:
    import nfl
    data = nfl.receiving(player, season=season)
    import charts
    data["chartBase64"] = charts.nfl_receiving(player, season, data["distribution"])
    return data


def _fn_nfl_epa(player: str, season: int = 2025) -> dict:
    import nfl
    data = nfl.player_epa(player, season=season)
    import charts
    data["chartBase64"] = charts.nfl_epa(player, season, data["totalEpa"], data["passEpa"], data["rushEpa"])
    return data


def _fn_nfl_season(player: str, season: int = 2025) -> dict:
    import nfl
    hits = nfl.search_players(player, limit=1)
    if not hits:
        raise ValueError(f"找不到球员: {player}")
    return nfl.player_season_stats(hits[0]["id"], season=season)


def _fn_nfl_game(game_id: str) -> dict:
    import nfl
    data = nfl.game_boxscore(game_id)
    import charts
    data["chartBase64"] = charts.nba_game_linescore(data["name"], data["linescore"])
    return data


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "nba_shooting",
            "description": "NBA 球员投篮构成分析：三分/两分/罚球的出手与命中率（含 eFG/TS）。",
            "parameters": {"type": "object", "properties": {
                "player": {"type": "string", "description": "球员名（中文或英文）"},
                "season": {"type": "integer", "description": "ESPN 赛季年份，2025-26 赛季=2026，默认 2026"},
            }, "required": ["player"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "nba_season",
            "description": "NBA 球员赛季场均与累计统计（得分/篮板/助攻/命中率等）。",
            "parameters": {"type": "object", "properties": {
                "player": {"type": "string"},
                "season": {"type": "integer", "description": "默认 2026"},
            }, "required": ["player"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "nba_game",
            "description": "NBA 单场赛后数据：比分、分节走势、球员统计（可生成赛后报告）。",
            "parameters": {"type": "object", "properties": {
                "game_id": {"type": "string", "description": "NBA 比赛 ID，如 401810433"},
            }, "required": ["game_id"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "nfl_season",
            "description": "NFL 球员赛季统计（传球/冲球/接球）。",
            "parameters": {"type": "object", "properties": {
                "player": {"type": "string", "description": "球员名（中文或英文）"},
                "season": {"type": "integer", "description": "默认 2025"},
            }, "required": ["player"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "nfl_game",
            "description": "NFL 单场赛后数据：比分、分节、关键球员（可生成赛后报告）。",
            "parameters": {"type": "object", "properties": {
                "game_id": {"type": "string", "description": "NFL 比赛 ID，如 401872656"},
            }, "required": ["game_id"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "nfl_receiving",
            "description": "NFL 球员接球方向分布（左/中/右）+ EPA（nflverse 高级数据）。",
            "parameters": {"type": "object", "properties": {
                "player": {"type": "string", "description": "球员英文名"},
                "season": {"type": "integer", "description": "默认 2025"},
            }, "required": ["player"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "nfl_epa",
            "description": "NFL 球员赛季 EPA 汇总（nflverse 高级数据）。",
            "parameters": {"type": "object", "properties": {
                "player": {"type": "string"},
                "season": {"type": "integer", "description": "默认 2025"},
            }, "required": ["player"]},
        },
    },
]

_FN_MAP = {
    "nba_shooting": _fn_nba_shooting,
    "nba_season": _fn_nba_season,
    "nba_game": _fn_nba_game,
    "nfl_season": _fn_nfl_season,
    "nfl_game": _fn_nfl_game,
    "nfl_receiving": _fn_nfl_receiving,
    "nfl_epa": _fn_nfl_epa,
}


def _llm():
    from openai import OpenAI
    return OpenAI(api_key=API_KEY, base_url=BASE_URL)


def _summarize(data: dict) -> str:
    """把结构化结果压成可喂给 Analyst 的文本摘要（去 base64）。"""
    d = {k: v for k, v in data.items() if k != "chartBase64"}
    return json.dumps(d, ensure_ascii=False, default=str)


class AskRequest(BaseModel):
    question: str
    season: Optional[str] = None


@router.post("/ask")
def ask(req: AskRequest):
    if not API_KEY:
        raise HTTPException(status_code=503, detail="未配置 LLM API Key（DEEPSEEK_API_KEY）")
    try:
        client = _llm()
        # Step 1: Planner
        planner = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "你是体育数据分析查询规划器。根据用户的中文问题，选择合适的工具。若问题涉及投篮/护框/球员效率等，选对应工具。只返回工具调用，不要解释。"},
                {"role": "user", "content": req.question},
            ],
            tools=TOOLS,
            tool_choice="auto",
            max_tokens=400,
        )
        msg = planner.choices[0].message
        if not msg.tool_calls:
            # 无工具：直接当一般问答
            answer = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": "你是 StatPilot 体育数据分析助手。用户的问题未匹配到数据工具，请说明可分析的方向（投篮热图、On/Off、护框、NFL EPA、接球分布、赛后报告），用中文回答，简洁。"},
                    {"role": "user", "content": req.question},
                ],
                max_tokens=500,
            )
            return {"answer": answer.choices[0].message.content, "chartBase64": None, "data": None}

        # Step 2: 执行工具
        results = []
        for tc in msg.tool_calls:
            fn_name = tc.function.name
            args = json.loads(tc.function.arguments or "{}")
            fn = _FN_MAP.get(fn_name)
            if not fn:
                raise HTTPException(status_code=400, detail=f"未知工具: {fn_name}")
            logger.info("planner → %s(%s)", fn_name, args)
            data = fn(**args)
            results.append({"tool": fn_name, "data": data, "summary": _summarize(data)})

        # Step 3: Analyst 解读
        tool_desc = "\n".join(
            f"[{r['tool']}] 数据摘要: {r['summary'][:1800]}" for r in results
        )
        analyst = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "你是 StatPilot 分析师。基于下方真实数据，用中文输出有洞察的解读：先一句结论，再 2-3 条关键发现（引用具体数字），最后一句行动/关注点。禁止编造数据，禁止使用「根据数据/可以看出」之类的空话。"},
                {"role": "user", "content": tool_desc},
            ],
            max_tokens=800,
        )
        first = results[0]
        return {
            "answer": analyst.choices[0].message.content,
            "chartBase64": first["data"].get("chartBase64"),
            "data": {k: v for k, v in first["data"].items() if k != "chartBase64"},
        }
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.error("ask failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"AI 分析失败: {e}")


class ReportRequest(BaseModel):
    league: str  # nba | nfl
    game_id: str


@router.post("/report")
def report(req: ReportRequest):
    """赛后报告：取数据 → LLM 生成四段式中文报告（走势/关键球员/拐点/结论）。"""
    if not API_KEY:
        raise HTTPException(status_code=503, detail="未配置 LLM API Key")
    try:
        if req.league == "nba":
            data = _fn_nba_game(req.game_id)
            summary = _summarize(data)
            chart = None
        elif req.league == "nfl":
            data = _fn_nfl_game(req.game_id)
            summary = _summarize(data)
            chart = None
        else:
            raise HTTPException(status_code=400, detail="league 必须为 nba 或 nfl")

        client = _llm()
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "你是 StatPilot 赛后报告撰稿人。基于真实数据生成 Markdown 格式中文报告，固定四段：## 比赛走势 / ## 关键球员 / ## 数据拐点 / ## 一句话结论。走势引用四节比分；关键球员列 2-3 人并带数据；拐点写 1-2 个改变比赛的节点；结论一句话。禁止编造。"},
                {"role": "user", "content": f"比赛数据:\n{summary[:3000]}"},
            ],
            max_tokens=900,
        )
        return {"league": req.league, "gameId": req.game_id, "report": resp.choices[0].message.content, "chartBase64": chart}
    except Exception as e:  # noqa: BLE001
        logger.error("report failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"报告生成失败: {e}")
