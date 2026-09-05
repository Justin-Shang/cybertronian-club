"""NFL 数据管道 — ESPN 公开 API 主数据源 + nflverse EPA 增强。

- ESPN：球队、球员搜索（roster）、赛季统计、赛程、单场 boxscore（稳定免 key）
- nflverse（nfl_data_py）：EPA / 接球方向分布（本地 parquet 就绪后可用；
  当前服务器无法快速访问 GitHub releases，parquet 落地后自动启用）
"""
import json
import logging
import os
import time
from typing import Optional

import httpx
import pandas as pd
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger("statpilot.nfl")

router = APIRouter()

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
CORE_BASE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "nfl")
os.makedirs(CACHE_DIR, exist_ok=True)
PLAYER_CACHE = os.path.join(CACHE_DIR, "nfl_players.json")

# ESPN Akamai 反爬：完整 Chrome UA 会被拦，用简化 UA
_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# 中文名 → 英文名（模糊搜索的中文匹配数据源；支持别名/绰号）
CN_NAME_MAP = {
    # 酋长 KC
    "马霍姆斯": "Patrick Mahomes", "马霍梅斯": "Patrick Mahomes", "帕特里克马霍姆斯": "Patrick Mahomes",
    "凯尔西": "Travis Kelce", "凯尔斯": "Travis Kelce", "特拉维斯凯尔西": "Travis Kelce",
    "帕切科": "Isiah Pacheco", "沃斯": "Xavier Worthy", "沃西": "Xavier Worthy",
    "亨特": "Rashee Rice", "琼斯克里斯": "Chris Jones",
    # 比尔 BUF
    "阿伦": "Josh Allen", "乔什阿伦": "Josh Allen", "约什阿伦": "Josh Allen",
    "迪格斯": "Stefon Diggs", "库克": "James Cook", "夏基尔": "Khalil Shakir",
    "塞缪尔": "Curtis Samuel", "米切尔": "Keon Coleman",
    # 乌鸦 BAL
    "杰克逊": "Lamar Jackson", "拉马尔": "Lamar Jackson", "拉马尔杰克逊": "Lamar Jackson",
    "亨利": "Derrick Henry", "德里克亨利": "Derrick Henry", "国王亨利": "Derrick Henry",
    "安德鲁斯": "Mark Andrews", "马克安德鲁斯": "Mark Andrews",
    "弗劳尔斯": "Zay Flowers", "莱利": "Rashod Bateman",
    # 猛虎 CIN
    "伯罗": "Joe Burrow", "乔伯罗": "Joe Burrow", "乔伊伯罗": "Joe Burrow",
    "蔡斯": "Ja'Marr Chase", "贾马尔蔡斯": "Ja'Marr Chase", "杰马尔蔡斯": "Ja'Marr Chase",
    "希金斯": "Tee Higgins", "蒂希金斯": "Tee Higgins",
    "迈克斯": "Joe Mixon", "米克森": "Joe Mixon",
    # 包装工 GB
    "拉夫": "Jordan Love", "乔丹拉夫": "Jordan Love",
    "雅各布斯": "Josh Jacobs", "沃特金斯": "Christian Watson",
    "里德": "Jayden Reed", "卡夫": "Tucker Kraft",
    # 49人 SF
    "普尔迪": "Brock Purdy", "布洛克普尔迪": "Brock Purdy", "先生无关紧要": "Brock Purdy",
    "麦卡弗里": "Christian McCaffrey", "CMC": "Christian McCaffrey", "克里斯蒂安麦卡弗里": "Christian McCaffrey",
    "凯特尔": "George Kittle", "乔治凯特尔": "George Kittle",
    "迪博": "Deebo Samuel", "迪博萨缪尔": "Deebo Samuel",
    "艾尤克": "Brandon Aiyuk", "威廉姆斯": "Trent Williams",
    # 公羊 LAR
    "斯特福德": "Matthew Stafford", "马修斯特福德": "Matthew Stafford",
    "库普": "Cooper Kupp", "库珀库普": "Cooper Kupp",
    "普卡": "Puka Nacua", "纳库阿": "Puka Nacua",
    "亨德森": "Kyren Williams", "凯伦威廉姆斯": "Kyren Williams",
    # 雄狮 DET
    "高夫": "Jared Goff", "贾里德高夫": "Jared Goff",
    "吉布斯": "Jahmyr Gibbs", "蒙哥马利": "David Montgomery",
    "拉波拉": "Amon-Ra St. Brown", "圣布朗": "Amon-Ra St. Brown",
    "拉弗勒": "Sam LaPorta", "休斯顿": "James Houston",
    # 海鹰 SEA
    "史密斯": "Geno Smith", "吉诺史密斯": "Geno Smith",
    "沃克": "Kenneth Walker III", "肯尼斯沃克": "Kenneth Walker III",
    "梅特卡夫": "DK Metcalf", "DK梅特卡夫": "DK Metcalf",
    "洛克斯": "Jaxon Smith-Njigba",
    # 老鹰 PHI
    "赫茨": "Jalen Hurts", "杰伦赫茨": "Jalen Hurts",
    "巴克利": "Saquon Barkley", "萨克万巴克利": "Saquon Barkley",
    "布朗AJ": "A.J. Brown", "AJ布朗": "A.J. Brown",
    "史密斯德文塔": "DeVonta Smith", "德文塔史密斯": "DeVonta Smith",
    "戈德特": "Dallas Goedert",
    # 牛仔 DAL
    "普雷斯科特": "Dak Prescott", "达克普雷斯科特": "Dak Prescott",
    "埃利奥特": "Ezekiel Elliott", "泽克": "Ezekiel Elliott",
    "兰姆": "CeeDee Lamb", "西迪兰姆": "CeeDee Lamb",
    "弗格森": "Jake Ferguson", "迪格斯特雷冯": "Trevon Diggs",
    # 巨人 NYG
    "琼斯丹尼尔": "Daniel Jones", "丹尼尔琼斯": "Daniel Jones",
    "纳伯斯": "Malik Nabers", "马利克纳伯斯": "Malik Nabers",
    "辛格塔里": "Tyrone Tracy Jr.",
    # 指挥官 WSH
    "丹尼尔斯": "Jayden Daniels", "杰登丹尼尔斯": "Jayden Daniels",
    "麦克劳夫林": "Brian Robinson Jr.",
    # 海豚 MIA
    "图阿": "Tua Tagovailoa", "塔戈瓦伊洛阿": "Tua Tagovailoa",
    "希尔": "Tyreek Hill", "泰里克希尔": "Tyreek Hill", "希尔斯": "Tyreek Hill", "猎豹": "Tyreek Hill",
    "瓦德尔": "Jaylen Waddle", "瓦德尔杰伦": "Jaylen Waddle",
    "阿查": "De'Von Achane",
    # 喷气机 NYJ
    "罗杰斯": "Aaron Rodgers", "阿隆罗杰斯": "Aaron Rodgers",
    "霍尔": "Breece Hall", "布里丝霍尔": "Breece Hall",
    "威尔逊加勒特": "Garrett Wilson", "加勒特威尔逊": "Garrett Wilson",
    "亚当斯": "Davante Adams", "达万特亚当斯": "Davante Adams",
    # 维京人 MIN
    "杰弗森": "Justin Jefferson", "贾斯汀杰弗森": "Justin Jefferson",
    "达布斯": "Jordan Addison", "阿迪森": "Jordan Addison",
    "琼斯亚伦": "Aaron Jones",
    # 熊 CHI
    "威廉姆斯凯勒布": "Caleb Williams", "凯勒布威廉姆斯": "Caleb Williams",
    "奥登雷": "D'Andre Swift", "斯威夫特": "D'Andre Swift",
    "摩尔DJ": "D.J. Moore",
    # 突击者 LV
    "明休": "Gardner Minshew", "迈耶斯": "Jakobi Meyers",
    "布罗登": "Brock Bowers", "布鲁克鲍尔斯": "Brock Bowers",
    # 野马 DEN
    "尼克斯": "Bo Nix", "博尼克斯": "Bo Nix",
    "萨顿": "Courtland Sutton", "科特兰萨顿": "Courtland Sutton",
    # 猎鹰 ATL
    "考辛斯": "Kirk Cousins", "柯克考辛斯": "Kirk Cousins",
    "宾汉姆": "Bijan Robinson", "比詹罗宾逊": "Bijan Robinson",
    "伦敦": "Drake London", "德雷克伦敦": "Drake London",
    "凯尔皮茨": "Kyle Pitts", "皮茨": "Kyle Pitts",
    # 圣徒 NO
    "卡尔": "Derek Carr", "德里克卡尔": "Derek Carr",
    "卡马拉": "Alvin Kamara", "阿尔文卡马拉": "Alvin Kamara",
    "奥拉维": "Chris Olave", "克里斯奥拉维": "Chris Olave",
    # 海盗 TB
    "梅菲尔德": "Baker Mayfield", "贝克梅菲尔德": "Baker Mayfield",
    "欧文": "Bucky Irving", "戈德温": "Chris Godwin",
    "埃文斯": "Mike Evans", "迈克埃文斯": "Mike Evans",
    # 德州人 HOU
    "斯特劳德": "C.J. Stroud", "斯特劳德CJ": "C.J. Stroud",
    "米克西": "Joe Mixon", "柯林斯": "Nico Collins",
    "德尔": "Tank Dell", "舒尔茨": "Dalton Schultz",
    # 小马 IND
    "理查德森": "Anthony Richardson", "安东尼理查德森": "Anthony Richardson",
    "泰勒": "Jonathan Taylor", "乔纳森泰勒": "Jonathan Taylor",
    "皮茨": "Michael Pittman Jr.",
    # 泰坦 TEN
    "利维斯": "Will Levis", "波拉德": "Tony Pollard",
    "霍普金斯": "DeAndre Hopkins",
    # 美洲虎 JAX
    "劳伦斯": "Trevor Lawrence", "特雷沃劳伦斯": "Trevor Lawrence",
    "艾蒂安": "Travis Etienne Jr.",
    # 钢人 PIT
    "菲尔兹": "Justin Fields", "威尔逊拉塞尔": "Russell Wilson",
    "哈里斯": "Najee Harris", "皮肯斯": "George Pickens",
    "瓦特": "T.J. Watt", "瓦茨": "T.J. Watt",
    # 布朗 CLE
    "沃特森": "Deshaun Watson", "德肖恩沃森": "Deshaun Watson",
    "查布": "Nick Chubb", "尼克查布": "Nick Chubb",
    "库珀": "Amari Cooper", "阿马里库珀": "Amari Cooper",
    # 黑豹 CAR
    "杨布莱斯": "Bryce Young", "布莱斯杨": "Bryce Young",
    "哈伯德": "Chuba Hubbard", "西萨": "Adam Thielen",
    # 红雀 ARI
    "默里": "Kyler Murray", "凯勒默里": "Kyler Murray",
    "哈里森": "Marvin Harrison Jr.", "马文哈里森": "Marvin Harrison Jr.",
    "康纳": "James Conner",
    # 电荷 LAC
    "赫伯特": "Justin Herbert", "贾斯汀赫伯特": "Justin Herbert",
    "哈博": "Jim Harbaugh", "艾伦基南": "Keenan Allen",
    "帕尔默": "Justin Palmer",
    # 爱国者 NE
    "梅奥": "Jerod Mayo", "德雷克梅": "Drake Maye", "梅伊": "Drake Maye",
    "史蒂文森": "Rhamondre Stevenson",
    "波尔克": "Ja'Lynn Polk",
}


def _get(url: str, timeout: float = 15.0) -> dict:
    for attempt in range(3):
        try:
            r = httpx.get(url, headers=_UA, timeout=timeout, follow_redirects=True)
            if r.status_code == 200:
                return r.json()
            logger.warning("ESPN NFL %s -> %s (attempt %d)", url, r.status_code, attempt + 1)
        except Exception as e:  # noqa: BLE001
            logger.warning("ESPN NFL fetch failed (attempt %d): %s", attempt + 1, e)
        time.sleep(1.5 * (attempt + 1))
    raise HTTPException(status_code=502, detail="ESPN 数据源请求失败")


def health() -> str:
    return "ok"


# ---------- 球员缓存（roster 遍历） ----------

def _load_player_cache() -> dict:
    if os.path.exists(PLAYER_CACHE):
        try:
            return json.load(open(PLAYER_CACHE, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    return {"players": [], "built_at": None}


def _build_player_cache() -> dict:
    teams = list_teams()
    players = []
    for t in teams:
        try:
            roster = _get(f"{ESPN_BASE}/teams/{t['id']}/roster", timeout=10)
            # NFL roster 是分组结构：athletes[].items[]
            for group in roster.get("athletes", []):
                for a in group.get("items", []):
                    pos = (a.get("position") or {})
                    if isinstance(pos, dict):
                        pos = pos.get("abbreviation", "")
                    players.append({
                        "id": str(a.get("id")),
                        "name": a.get("displayName", ""),
                        "shortName": a.get("shortName", ""),
                        "team": t["abbr"],
                        "teamName": t["name"],
                        "position": pos,
                    })
        except Exception as e:  # noqa: BLE001
            logger.warning("nfl roster failed for %s: %s", t["abbr"], e)
        time.sleep(0.15)
    cache = {"players": players, "built_at": time.strftime("%Y-%m-%d %H:%M:%S")}
    with open(PLAYER_CACHE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    logger.info("nfl player cache built: %d players", len(players))
    return cache


def _get_players() -> list:
    cache = _load_player_cache()
    players = cache.get("players", [])
    if not players:
        return _build_player_cache().get("players", [])
    return players


# ---------- ESPN 端点 ----------

@router.get("/teams")
def list_teams():
    d = _get(f"{ESPN_BASE}/teams")
    teams = []
    for t in d.get("sports", [{}])[0].get("leagues", [{}])[0].get("teams", []):
        tm = t.get("team", {})
        teams.append({"id": tm.get("id"), "abbr": tm.get("abbreviation"), "name": tm.get("displayName")})
    return teams


def _team_abbr_map() -> dict:
    """球队全名 → 缩写（在线搜索结果补缩写用）。"""
    out = {}
    try:
        for t in list_teams():
            out[t["name"].lower()] = t["abbr"]
    except Exception:  # noqa: BLE001
        pass
    return out


def _online_search(query: str, limit: int) -> list:
    """ESPN 在线搜索兜底：覆盖不在当前 roster 的球员（交易/伤停/名单滞后）。

    中文查询先经 CN_NAME_MAP 转英文再搜（ESPN 不识别中文）。
    """
    from urllib.parse import quote
    from playersearch import parse_espn_search
    try:
        term = CN_NAME_MAP.get(query.strip(), query.strip())
        url = "https://site.web.api.espn.com/apis/search/v2?limit=" + str(limit) + "&query=" + quote(term)
        d = _get(url, timeout=10)
        hits = parse_espn_search(d, "NFL")
        abbrs = _team_abbr_map()
        for p in hits:
            p["team"] = abbrs.get((p["teamName"] or "").lower(), "")
            cns = [cn for cn, en in CN_NAME_MAP.items()
                   if en.lower() in p["name"].lower() or p["name"].lower() in en.lower()]
            p["cnName"] = cns[0] if cns else None
            p["cnNames"] = cns
        return hits
    except Exception as e:  # noqa: BLE001
        logger.warning("nfl online search failed: %s", e)
        return []


@router.get("/players/search")
def search_players(q: str = Query(..., min_length=1), limit: int = Query(10, le=25)):
    """模糊搜索球员：中文名/别名/绰号、英文名（支持单词乱序）、拼写容错。

    结果合并：本地 roster 缓存（全）+ ESPN 在线搜索（知名球员优先，roster 滞于
    交易/伤停时仍能搜到）。term >= 3 字符才触发在线（避免逐键打字时高频外呼）。
    """
    from playersearch import fuzzy_search
    players = _get_players()
    hits = fuzzy_search(players, q, CN_NAME_MAP, limit=limit)
    if not hits:
        q_l = q.strip().lower()
        hits = [
            p for p in players
            if q_l in p["name"].lower() or q_l in (p.get("shortName") or "").lower()
        ][:limit]

    # 在线结果在前（ESPN 按知名度排序，明星优先），去重后合并本地结果
    term = CN_NAME_MAP.get(q.strip(), q.strip())
    online = _online_search(q, limit) if len(term) >= 3 else []
    if online:
        seen = {p["name"].lower() for p in online}
        merged = online + [p for p in hits if p["name"].lower() not in seen]
        hits = merged[:limit]
    return hits


@router.get("/players/{player_id}/season-stats")
def player_season_stats(player_id: str, season: int = Query(2026)):
    """NFL 球员赛季统计（ESPN core API）。season: 2025=NFL 2025 赛季，2026=2026 赛季。"""
    url = f"{CORE_BASE}/seasons/{season}/types/2/athletes/{player_id}/statistics/0?lang=en&region=us"
    d = _get(url)
    cats = {}
    try:
        for c in d["splits"]["categories"]:
            stats = {}
            for s in c.get("stats", []):
                stats[s["name"]] = s.get("displayValue")
            cats[c["name"]] = stats
    except Exception as e:  # noqa: BLE001
        logger.warning("nfl season-stats parse failed: %s", e)
        raise HTTPException(status_code=404, detail="无该球员赛季统计")

    pas = cats.get("passing", {})
    rus = cats.get("rushing", {})
    rec = cats.get("receiving", {})
    gen = cats.get("general", {})
    players = _get_players()
    info = next((p for p in players if p["id"] == player_id), {})
    return {
        "playerId": player_id,
        "name": info.get("name") or "?",
        "team": info.get("team", ""),
        "position": info.get("position", ""),
        "season": season,
        "passing": {
            "attempts": pas.get("passingAttempts"), "completions": pas.get("completions"),
            "yards": pas.get("passingYards"), "td": pas.get("passingTouchdowns"),
            "int": pas.get("interceptions"), "pct": pas.get("completionPct"),
        },
        "rushing": {
            "attempts": rus.get("rushingAttempts"), "yards": rus.get("rushingYards"),
            "td": rus.get("rushingTouchdowns"), "avg": rus.get("avgYardsPerRush"),
        },
        "receiving": {
            "receptions": rec.get("receptions"), "yards": rec.get("receivingYards"),
            "td": rec.get("receivingTouchdowns"), "targets": rec.get("targets"),
        },
        "games": gen.get("gamesPlayed"),
    }


@router.get("/games/scoreboard")
def scoreboard(date: str = Query("", description="YYYYMMDD，空=当日")):
    url = f"{ESPN_BASE}/scoreboard" + (f"?dates={date}" if date else "")
    d = _get(url)
    games = []
    for e in d.get("events", []):
        comp = e.get("competitions", [{}])[0]
        competitors = {c["homeAway"]: c for c in comp.get("competitors", [])}
        status = comp.get("status", {}).get("type", {}).get("description", "")
        def team(side):
            c = competitors.get(side, {})
            return {"abbr": c.get("team", {}).get("abbreviation", ""), "score": c.get("score")}
        games.append({
            "gameId": e["id"],
            "name": e.get("name", ""),
            "date": e.get("date", ""),
            "status": status,
            "home": team("home"),
            "away": team("away"),
        })
    return {"games": games}


@router.get("/games/{game_id}/boxscore")
def game_boxscore(game_id: str):
    """NFL 单场数据：比分、分节（四节+加时）、关键球员统计。"""
    d = _get(f"{ESPN_BASE}/summary?event={game_id}")
    try:
        comp = d["header"]["competitions"][0]
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=404, detail="找不到该比赛")

    competitors = {c["homeAway"]: c for c in comp.get("competitors", [])}
    def team(side):
        c = competitors.get(side, {})
        return {"abbr": c.get("team", {}).get("abbreviation", ""), "name": c.get("team", {}).get("displayName", ""), "score": c.get("score")}

    # 分节比分
    linescore = []
    for side in ("home", "away"):
        c = competitors.get(side, {})
        for ls in c.get("linescores", []):
            linescore.append({"team": c.get("team", {}).get("abbreviation", ""), "period": ls.get("period", {}).get("number"), "pts": ls.get("value")})

    # 关键球员（leaders）
    players = []
    for L in d.get("leaders", []):
        for l in L.get("leaders", []):
            a = l.get("athlete", {})
            if a:
                players.append({"name": a.get("displayName", ""), "team": (l.get("team") or {}).get("abbreviation", ""), "stat": l.get("displayValue", "")})

    return {
        "gameId": game_id,
        "name": comp.get("name", ""),
        "date": comp.get("date", ""),
        "status": comp.get("status", {}).get("type", {}).get("description", ""),
        "home": team("home"),
        "away": team("away"),
        "linescore": linescore,
        "keyPlayers": players[:20],
    }


# ---------- nflverse EPA（本地 parquet 就绪后可用） ----------

def _pbp(seasons=None):
    """加载 play-by-play 数据：本地 parquet 优先，否则 nfl_data_py 下载（慢）。"""
    seasons = seasons or [2025]
    local_files = [os.path.join(CACHE_DIR, f"play_by_play_{y}.parquet") for y in seasons]
    existing = [f for f in local_files if os.path.exists(f)]
    if existing:
        t0 = time.time()
        frames = [pd.read_parquet(f) for f in existing]
        df = pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]
        logger.info("nfl pbp loaded from local (%d rows) in %.1fs", len(df), time.time() - t0)
        return df
    import nfl_data_py as nfl
    t0 = time.time()
    df = nfl.import_pbp_data(seasons, cache=True, alt_path=CACHE_DIR)
    logger.info("nfl pbp loaded via nfl_data_py (%d rows) in %.1fs", len(df), time.time() - t0)
    return df


@router.get("/players/{player_name}/receiving")
def receiving(player_name: str, season: int = Query(2025)):
    """接球方向分布（nflverse，需本地 parquet）。"""
    try:
        pbp = _pbp([season])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail="EPA 数据未就绪（需下载 nflverse 数据，当前网络受限）")
    target = pbp[(pbp["receiver"] == player_name) & (pbp["play_type"] == "pass")].copy()
    if target.empty:
        raise HTTPException(status_code=404, detail="无接球数据（球员名或赛季有误）")
    loc = target.groupby("pass_location").agg(
        targets=("pass_location", "size"), completions=("complete_pass", "sum"),
        yards=("yards_gained", "sum"), air=("air_yards", "mean"),
        yac=("yards_after_catch", "mean"), epa=("epa", "sum"),
    ).reset_index()
    loc.columns = ["location", "targets", "completions", "yards", "avgAirYards", "avgYac", "totalEpa"]
    data = {
        "player": player_name, "season": season,
        "targets": int(target["pass_location"].size), "receptions": int(target["complete_pass"].sum()),
        "yards": int(target["yards_gained"].sum()),
        "touchdowns": int(target["touchdown"].sum()) if "touchdown" in target.columns else 0,
        "totalEpa": round(float(target["epa"].sum()), 2),
        "touchEpa": round(float(target["epa"].sum()), 2),
        "distribution": loc.to_dict("records"),
        "source": "nflverse",
    }
    try:
        import charts
        data["chartBase64"] = charts.nfl_receiving(player_name, season, data["distribution"])
    except Exception as e:  # noqa: BLE001
        logger.warning("nfl receiving chart failed: %s", e)
        data["chartBase64"] = None
    return data


@router.get("/players/{player_name}/epa")
def player_epa(player_name: str, season: int = Query(2025)):
    """赛季 EPA（nflverse，需本地 parquet）。"""
    try:
        pbp = _pbp([season])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail="EPA 数据未就绪（需下载 nflverse 数据，当前网络受限）")
    sub = pbp[(pbp["receiver"] == player_name) | (pbp["rusher"] == player_name)]
    if sub.empty:
        raise HTTPException(status_code=404, detail="无该球员 EPA 数据")
    games = sub["game_id"].nunique()
    total = float(sub["epa"].sum())
    data = {
        "player": player_name, "season": season, "games": int(games), "plays": int(len(sub)),
        "totalEpa": round(total, 2),
        "avgPerGame": round(total / games, 2) if games else None,
        "avgPerPlay": round(total / len(sub), 2) if len(sub) else None,
        "passEpa": round(float(sub[sub["play_type"] == "pass"]["epa"].sum()), 2),
        "rushEpa": round(float(sub[sub["play_type"] == "run"]["epa"].sum()), 2),
        "source": "nflverse",
    }
    try:
        import charts
        data["chartBase64"] = charts.nfl_epa(player_name, season, data["totalEpa"], data["passEpa"], data["rushEpa"])
    except Exception as e:  # noqa: BLE001
        logger.warning("nfl epa chart failed: %s", e)
        data["chartBase64"] = None
    return data
