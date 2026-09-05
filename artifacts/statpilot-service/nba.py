"""NBA 数据管道 — ESPN 公开 API（无 key、无反爬、稳定）。

端点：
- 球队名单 roster（构建球员搜索缓存）
- 球员赛季统计（sports.core.api statistics）
- 单场 boxscore + 比分（summary）
- 历史/当日赛程（scoreboard）

说明：stats.nba.com 在服务器上被 Akamai Bot Manager 拦截（返回 HTML challenge），
投篮坐标热图不可用，MVP 用「投篮构成图」（FG/3P/FT）替代。
"""
import json
import logging
import os
import time
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger("statpilot.nba")

router = APIRouter()

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
CORE_BASE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba"
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(CACHE_DIR, exist_ok=True)
PLAYER_CACHE = os.path.join(CACHE_DIR, "nba_players.json")

# 注意：ESPN Akamai 会拦截「完整 Chrome UA + 非浏览器 TLS 指纹」的请求，
# 但对简化 UA / 空 UA 放行。这里故意用简化 UA。
_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# 球星中文名 → 英文名（模糊搜索的中文匹配数据源；支持别名/绰号）
CN_NAME_MAP = {
    # 马刺
    "文班": "Wembanyama", "文班亚马": "Wembanyama", "斑马": "Wembanyama", "维克托文班亚马": "Wembanyama",
    "卡斯尔": "Stephon Castle", "福克斯": "De'Aaron Fox",
    # 湖人
    "詹姆斯": "LeBron James", "老詹": "LeBron James", "勒布朗": "LeBron James", "勒布朗詹姆斯": "LeBron James",
    "东契奇": "Luka Doncic", "卢卡": "Luka Doncic", "77": "Luka Doncic",
    "戴维斯": "Anthony Davis", "浓眉": "Anthony Davis", "安东尼戴维斯": "Anthony Davis",
    "里夫斯": "Austin Reaves", "八村垒": "Rui Hachimura", "八村": "Rui Hachimura", "八村塁": "Rui Hachimura",
    "芬尼史密斯": "Dorian Finney-Smith",
    # 勇士
    "库里": "Stephen Curry", "小学生": "Stephen Curry", "斯蒂芬库里": "Stephen Curry", "库日天": "Stephen Curry",
    "汤普森": "Klay Thompson", "克莱": "Klay Thompson", "佛祖": "Klay Thompson",
    "格林": "Draymond Green", "追梦": "Draymond Green",
    "巴特勒": "Jimmy Butler", "吉米巴特勒": "Jimmy Butler", "巴老板": "Jimmy Butler",
    "波杰姆斯基": "Brandin Podziemski", "库明加": "Jonathan Kuminga", "穆迪": "Moses Moody",
    # 太阳
    "杜兰特": "Kevin Durant", "阿杜": "Kevin Durant", "死神": "Kevin Durant", "凯文杜兰特": "Kevin Durant",
    "布克": "Devin Booker", "德文布克": "Devin Booker", "比尔": "Bradley Beal",
    # 掘金
    "约基奇": "Nikola Jokic", "约老师": "Nikola Jokic", "尼古拉约基奇": "Nikola Jokic",
    "穆雷": "Jamal Murray", "戈登": "Aaron Gordon", "小波特": "Michael Porter Jr.",
    "威斯布鲁克": "Russell Westbrook", "威少": "Russell Westbrook",
    # 雄鹿
    "字母哥": "Giannis Antetokounmpo", "扬尼斯": "Giannis Antetokounmpo", "安特托昆博": "Giannis Antetokounmpo",
    "利拉德": "Damian Lillard", "达米安利拉德": "Damian Lillard", "表哥": "Damian Lillard",
    "库兹马": "Kyle Kuzma", "洛佩兹": "Brook Lopez",
    # 快船
    "哈登": "James Harden", "詹姆士哈登": "James Harden", "大胡子": "James Harden",
    "伦纳德": "Kawhi Leonard", "莱昂纳德": "Kawhi Leonard", "卡哇伊": "Kawhi Leonard",
    "鲍威尔": "Norman Powell", "祖巴茨": "Ivica Zubac",
    # 雷霆
    "亚历山大": "Shai Gilgeous-Alexander", "SGA": "Shai Gilgeous-Alexander", "谢伊": "Shai Gilgeous-Alexander",
    "霍姆格伦": "Chet Holmgren", "切特": "Chet Holmgren",
    "威廉姆斯": "Jalen Williams", "杰伦威廉姆斯": "Jalen Williams",
    "哈滕": "Isaiah Hartenstein", "卡鲁索": "Alex Caruso",
    # 森林狼
    "爱德华兹": "Anthony Edwards", "华子": "Anthony Edwards", "安东尼爱德华兹": "Anthony Edwards",
    "戈贝尔": "Rudy Gobert", "鲁迪戈贝尔": "Rudy Gobert", "法国铁塔": "Rudy Gobert",
    "兰德尔": "Julius Randle", "麦克丹尼尔斯": "Jaden McDaniels",
    # 凯尔特人
    "塔图姆": "Jayson Tatum", "獭兔": "Jayson Tatum", "杰森塔图姆": "Jayson Tatum",
    "布朗": "Jaylen Brown", "杰伦布朗": "Jaylen Brown",
    "怀特": "Derrick White", "德里克怀特": "Derrick White",
    "波尔津吉斯": "Kristaps Porzingis", "波神": "Kristaps Porzingis",
    "霍勒迪": "Jrue Holiday", "朱霍勒迪": "Jrue Holiday",
    # 尼克斯
    "布朗森": "Jalen Brunson", "布伦森": "Jalen Brunson", "杰伦布伦森": "Jalen Brunson",
    "唐斯": "Karl-Anthony Towns", "卡尔安东尼唐斯": "Karl-Anthony Towns", "KAT": "Karl-Anthony Towns",
    "阿奴诺比": "OG Anunoby", "布里奇斯": "Mikal Bridges", "哈特": "Josh Hart",
    # 76人
    "恩比德": "Joel Embiid", "大帝": "Joel Embiid", "乔尔恩比德": "Joel Embiid",
    "马克西": "Tyrese Maxey", "泰瑞斯马克西": "Tyrese Maxey",
    "保罗乔治": "Paul George", "泡椒": "Paul George", "乔治": "Paul George",
    "格莱姆斯": "Quentin Grimes",
    # 骑士
    "米切尔": "Donovan Mitchell", "多诺万米切尔": "Donovan Mitchell",
    "加兰": "Darius Garland", "达柳斯加兰": "Darius Garland",
    "莫布里": "Evan Mobley", "埃文莫布里": "Evan Mobley",
    "阿伦": "Jarrett Allen", "杰罗姆": "Ty Jerome",
    # 步行者
    "哈利伯顿": "Tyrese Haliburton", "泰里斯哈利伯顿": "Tyrese Haliburton",
    "西亚卡姆": "Pascal Siakam", "帕斯卡尔西亚卡姆": "Pascal Siakam",
    "特纳": "Myles Turner", "马图林": "Bennedict Mathurin",
    # 魔术
    "班凯罗": "Paolo Banchero", "保罗班凯罗": "Paolo Banchero",
    "瓦格纳": "Franz Wagner", "弗朗茨瓦格纳": "Franz Wagner",
    "莫里茨瓦格纳": "Moe Wagner",
    # 热火
    "阿德巴约": "Bam Adebayo", "巴姆阿德巴约": "Bam Adebayo",
    "希罗": "Tyler Herro", "泰勒希罗": "Tyler Herro",
    "维金斯": "Andrew Wiggins", "安德鲁维金斯": "Andrew Wiggins",
    "韦尔": "Kel'el Ware",
    # 火箭
    "申京": "Alperen Sengun", "申京阿尔佩伦": "Alperen Sengun",
    "格林杰伦": "Jalen Green", "杰伦格林": "Jalen Green",
    "范弗里特": "Fred VanVleet", "范乔丹": "Fred VanVleet",
    "汤普森阿门": "Amen Thompson", "阿门": "Amen Thompson",
    "伊森": "Tari Eason", "史密斯": "Jabari Smith Jr.",
    # 灰熊
    "莫兰特": "Ja Morant", "贾莫兰特": "Ja Morant", "腰王": "Ja Morant",
    "杰克逊": "Jaren Jackson Jr.", "小贾伦杰克逊": "Jaren Jackson Jr.", "3J": "Jaren Jackson Jr.",
    "贝恩": "Desmond Bane", "德斯蒙德贝恩": "Desmond Bane",
    "埃迪": "Zach Edey", "周志豪": "Zach Edey",
    # 鹈鹕
    "锡安": "Zion Williamson", "蔡恩": "Zion Williamson", "威廉森": "Zion Williamson",
    "英格拉姆": "Brandon Ingram", "布兰登英格拉姆": "Brandon Ingram",
    "墨菲": "Trey Murphy III", "琼斯": "Herbert Jones",
    # 国王
    "拉文": "Zach LaVine", "扎克拉文": "Zach LaVine",
    "萨博尼斯": "Domantas Sabonis", "小萨": "Domantas Sabonis",
    "德罗赞": "DeMar DeRozan", "德玛尔德罗赞": "DeMar DeRozan",
    "蒙克": "Malik Monk", "基根默里": "Keegan Murray", "默里": "Keegan Murray",
    # 独行侠
    "欧文": "Kyrie Irving", "凯里欧文": "Kyrie Irving", "德鲁大叔": "Kyrie Irving",
    "浓眉哥": "Anthony Davis", "克里斯蒂": "Max Christie", "华盛顿": "P.J. Washington",
    # 爵士
    "马尔卡宁": "Lauri Markkanen", "劳里马尔卡宁": "Lauri Markkanen",
    "塞克斯顿": "Collin Sexton", "凯斯勒": "Walker Kessler",
    # 开拓者
    "西蒙斯": "Anfernee Simons", "安芬尼西蒙斯": "Anfernee Simons",
    "夏普": "Shaedon Sharpe", "亨德森": "Scoot Henderson", "克林根": "Donovan Clingan",
    # 篮网
    "克拉克斯顿": "Nic Claxton", "卡梅隆约翰逊": "Cameron Johnson",
    "托马斯": "Cam Thomas", "卡梅隆托马斯": "Cam Thomas",
    # 猛龙
    "巴恩斯": "Scottie Barnes", "斯科蒂巴恩斯": "Scottie Barnes",
    "巴雷特": "RJ Barrett", "RJ巴雷特": "RJ Barrett", "英格尔斯": "Joe Ingles",
    # 公牛
    "武切维奇": "Nikola Vucevic", "尼古拉武切维奇": "Nikola Vucevic",
    "吉迪": "Josh Giddey", "约什吉迪": "Josh Giddey",
    "怀特科比": "Coby White", "科比怀特": "Coby White",
    # 老鹰
    "特雷杨": "Trae Young", "吹杨": "Trae Young", "杨": "Trae Young",
    "丹尼尔斯": "Dyson Daniels", "戴森丹尼尔斯": "Dyson Daniels",
    "约翰逊杰伦": "Jalen Johnson", "奥孔古": "Onyeka Okongwu",
    # 黄蜂
    "鲍尔": "LaMelo Ball", "拉梅洛鲍尔": "LaMelo Ball", "三球": "LaMelo Ball",
    "米勒": "Brandon Miller", "布兰登米勒": "Brandon Miller",
    "布里奇斯迈尔斯": "Miles Bridges",
    # 活塞
    "坎宁安": "Cade Cunningham", "凯德坎宁安": "Cade Cunningham",
    "杜伦": "Jalen Duren", "艾维": "Jaden Ivey", "哈里斯": "Tobias Harris",
    "汤普森奥萨尔": "Ausar Thompson",
    # 奇才
    "普尔": "Jordan Poole", "乔丹普尔": "Jordan Poole",
    "萨尔": "Alex Sarr", "库利巴利": "Bilal Coulibaly",
    # 猛龙/其他角色球员
    "保罗": "Chris Paul", "圣保罗": "Chris Paul", "炮哥": "Chris Paul",
    "威金斯库明加": "Jonathan Kuminga",
    # 历史巨星（便于习惯性搜索）
    "乔丹": "Michael Jordan", "科比": "Kobe Bryant", "黑曼巴": "Kobe Bryant",
    "奥尼尔": "Shaquille O'Neal", "大鲨鱼": "Shaquille O'Neal",
    "邓肯": "Tim Duncan", "石佛": "Tim Duncan",
    "诺维茨基": "Dirk Nowitzki", "司机": "Dirk Nowitzki",
    "韦德": "Dwyane Wade", "闪电侠": "Dwyane Wade",
    "加内特": "Kevin Garnett", "狼王": "Kevin Garnett",
    "艾弗森": "Allen Iverson", "答案": "Allen Iverson",
    "纳什": "Steve Nash", "基德": "Jason Kidd",
    "麦迪": "Tracy McGrady", "卡特": "Vince Carter", "半人半神": "Vince Carter",
    "罗德曼": "Dennis Rodman", "大虫": "Dennis Rodman",
    "巴克利": "Charles Barkley", "马龙": "Karl Malone",
    "斯托克顿": "John Stockton", "尤因": "Patrick Ewing",
    "奥拉朱旺": "Hakeem Olajuwon", "大梦": "Hakeem Olajuwon",
    "伯德": "Larry Bird", "大鸟": "Larry Bird", "魔术师": "Magic Johnson", "约翰逊": "Magic Johnson",
    "张伯伦": "Wilt Chamberlain", "拉塞尔": "Bill Russell", "指环王": "Bill Russell",
}


def _get(url: str, timeout: float = 15.0) -> dict:
    for attempt in range(3):
        try:
            r = httpx.get(url, headers=_UA, timeout=timeout, follow_redirects=True)
            if r.status_code == 200:
                return r.json()
            logger.warning("ESPN %s -> %s body=%s (attempt %d)", url, r.status_code, r.text[:200], attempt + 1)
        except Exception as e:  # noqa: BLE001
            logger.warning("ESPN fetch failed (attempt %d): %s", attempt + 1, e)
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
    """遍历 30 队 roster，构建球员索引。约 30 个请求，耗时 ~20s。"""
    teams = list_teams()
    players = []
    for t in teams:
        try:
            roster = _get(f"{ESPN_BASE}/teams/{t['id']}/roster", timeout=10)
            for a in roster.get("athletes", []):
                pos = (a.get("position") or {}).get("abbreviation", "")
                players.append({
                    "id": str(a.get("id")),
                    "name": a.get("displayName", ""),
                    "shortName": a.get("shortName", ""),
                    "team": t["abbr"],
                    "teamName": t["name"],
                    "position": pos,
                })
        except Exception as e:  # noqa: BLE001
            logger.warning("roster failed for %s: %s", t["abbr"], e)
        time.sleep(0.15)
    cache = {"players": players, "built_at": time.strftime("%Y-%m-%d %H:%M:%S")}
    with open(PLAYER_CACHE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    logger.info("player cache built: %d players", len(players))
    return cache


def _get_players() -> list:
    cache = _load_player_cache()
    players = cache.get("players", [])
    # 缓存过期（>6h）或为空则重建
    if not players:
        return _build_player_cache().get("players", [])
    return players


# ---------- 端点 ----------

@router.get("/teams")
def list_teams():
    """ESPN 球队列表（id 为 ESPN 内部 1-30）。"""
    d = _get(f"{ESPN_BASE}/teams")
    teams = []
    for t in d.get("sports", [{}])[0].get("leagues", [{}])[0].get("teams", []):
        tm = t.get("team", {})
        teams.append({"id": tm.get("id"), "abbr": tm.get("abbreviation"), "name": tm.get("displayName")})
    if not teams:
        # 兜底静态列表（ESPN 标准 id）
        fallback = ["ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GSW","HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NOP","NYK","OKC","ORL","PHI","PHX","POR","SAC","SAS","TOR","UTA","WAS"]
        teams = [{"id": str(i + 1), "abbr": a, "name": a} for i, a in enumerate(fallback)]
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
        hits = parse_espn_search(d, "NBA")
        abbrs = _team_abbr_map()
        for p in hits:
            p["team"] = abbrs.get((p["teamName"] or "").lower(), "")
            cns = [cn for cn, en in CN_NAME_MAP.items()
                   if en.lower() in p["name"].lower() or p["name"].lower() in en.lower()]
            p["cnName"] = cns[0] if cns else None
            p["cnNames"] = cns
        return hits
    except Exception as e:  # noqa: BLE001
        logger.warning("nba online search failed: %s", e)
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
    """球员赛季统计（core API）。season: ESPN 年份（2025-26 赛季 = 2026）。"""
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
        logger.warning("season-stats parse failed: %s", e)
        raise HTTPException(status_code=404, detail="无该球员赛季统计")

    off = cats.get("offensive", {})
    gen = cats.get("general", {})
    deff = cats.get("defensive", {})
    # 查询球员名
    players = _get_players()
    info = next((p for p in players if p["id"] == player_id), {})
    return {
        "playerId": player_id,
        "name": info.get("name") or off.get("points", "?"),
        "team": info.get("team", ""),
        "position": info.get("position", ""),
        "season": season,
        "perGame": {
            "points": off.get("avgPoints"),
            "rebounds": gen.get("avgRebounds"),
            "assists": off.get("avgAssists"),
            "steals": deff.get("avgSteals"),
            "blocks": deff.get("avgBlocks"),
            "fgPct": off.get("fieldGoalPct"),
            "threePct": off.get("threePointPct"),
            "ftPct": off.get("freeThrowPct"),
            "minutes": gen.get("avgMinutes"),
        },
        "totals": {
            "games": gen.get("gamesPlayed"),
            "fgm": off.get("fieldGoalsMade"),
            "fga": off.get("fieldGoalsAttempted"),
            "tpm": off.get("threePointFieldGoalsMade"),
            "tpa": off.get("threePointFieldGoalsAttempted"),
            "ftm": off.get("freeThrowsMade"),
            "fta": off.get("freeThrowsAttempted"),
            "plusMinus": gen.get("plusMinus"),
        },
        "advanced": {
            "per": gen.get("PER"),
            "effFgPct": off.get("effectiveFGPct"),
            "tsPct": off.get("trueShootingPct"),
            "usage": off.get("usageRate"),
        },
        "raw": cats,
    }


@router.get("/players/{player_id}/shooting")
def player_shooting(player_id: str, season: int = Query(2026)):
    """投篮构成：三分/两分/罚球 出手与命中（热图坐标不可得，用构成替代）。附带图表。"""
    stats = player_season_stats(player_id, season=season)
    t = stats["totals"]
    fgm, fga = _f(t.get("fgm")), _f(t.get("fga"))
    tpm, tpa = _f(t.get("tpm")), _f(t.get("tpa"))
    ftm, fta = _f(t.get("ftm")), _f(t.get("fta"))
    twom = fgm - tpm
    twoa = fga - tpa
    data = {
        "name": stats["name"], "team": stats["team"], "season": season,
        "three": {"made": tpm, "attempted": tpa, "pct": round(tpm / tpa * 100, 1) if tpa else None},
        "two": {"made": twom, "attempted": twoa, "pct": round(twom / twoa * 100, 1) if twoa else None},
        "freeThrow": {"made": ftm, "attempted": fta, "pct": round(ftm / fta * 100, 1) if fta else None},
        "eFgPct": round((fgm + 0.5 * tpm) / fga * 100, 1) if fga else None,
        "tsPct": round((2 * (fgm + 0.44 * ftm)) / (2 * fga + fta) * 100, 1) if (fga or fta) else None,
    }
    try:
        import charts
        data["chartBase64"] = charts.nba_shooting(data["name"], data["team"], season, data)
    except Exception as e:  # noqa: BLE001
        logger.warning("shooting chart failed: %s", e)
        data["chartBase64"] = None
    return data


def _f(v) -> int:
    try:
        return int(v) if v is not None else 0
    except (TypeError, ValueError):
        return 0


# ---------- 赛程 / 比分 ----------

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
    """单场完整数据：比分、四节走势、球员统计、球队统计。"""
    d = _get(f"{ESPN_BASE}/summary?event={game_id}")
    try:
        comp = d["header"]["competitions"][0]
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=404, detail="找不到该比赛")

    competitors = {c["homeAway"]: c for c in comp.get("competitors", [])}
    def team(side):
        c = competitors.get(side, {})
        return {"abbr": c.get("team", {}).get("abbreviation", ""), "name": c.get("team", {}).get("displayName", ""), "score": c.get("score")}

    home = team("home")
    away = team("away")

    # 四节比分（linescores）
    linescore = []
    for side in ("home", "away"):
        c = competitors.get(side, {})
        for ls in c.get("linescores", []):
            linescore.append({"team": c.get("team", {}).get("abbreviation", ""), "period": ls.get("period", {}).get("number"), "pts": ls.get("value")})

    # 球员数据
    players = []
    for pl in d.get("boxscore", {}).get("players", []):
        team_abbr = pl.get("team", {}).get("abbreviation", "")
        for st in pl.get("statistics", []):
            names = st.get("names", [])
            for a in st.get("athletes", []):
                if a.get("didNotPlay") or a.get("stats") is None:
                    continue
                pstats = dict(zip(names, a["stats"]))
                if not pstats.get("PTS"):
                    continue
                def g(k):
                    try:
                        return float(pstats.get(k, 0)) if pstats.get(k) not in (None, "") else 0.0
                    except (TypeError, ValueError):
                        return 0.0
                players.append({
                    "id": a.get("athlete", {}).get("id", ""),
                    "name": a.get("athlete", {}).get("displayName", ""),
                    "team": team_abbr,
                    "starter": bool(a.get("starter")),
                    "position": a.get("athlete", {}).get("position", {}).get("abbreviation", ""),
                    "min": pstats.get("MIN", "0"),
                    "pts": g("PTS"), "reb": g("REB"), "ast": g("AST"),
                    "stl": g("STL"), "blk": g("BLK"), "tov": g("TO"),
                    "plusMinus": g("+/-"),
                    "fg": pstats.get("FG", "0-0"), "tp": pstats.get("3PT", "0-0"), "ft": pstats.get("FT", "0-0"),
                })

    players.sort(key=lambda p: (-p["pts"], -p["reb"]))
    return {
        "gameId": game_id,
        "name": comp.get("name", ""),
        "date": comp.get("date", ""),
        "home": home,
        "away": away,
        "status": comp.get("status", {}).get("type", {}).get("description", ""),
        "linescore": linescore,
        "players": players,
        "leader": (d.get("leaders") or [{}])[0].get("leaders", [{}])[0].get("athlete", {}).get("displayName", None),
    }
