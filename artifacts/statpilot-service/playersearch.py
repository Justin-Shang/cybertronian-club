"""球员模糊搜索引擎 — 中英文、多词、拼写容错。

匹配策略（按得分降序）：
1. 精确子串：query 是某字段的子串（覆盖度越高分越高）→ 0.90+
2. 多词命中：英文 query 按空格拆词，每个词都命中（顺序无关，"james lebron" → LeBron James）→ 0.75+
3. 拼写容错：difflib 序列相似度（"wembanyana" → Wembanyama）→ ratio

中文名：通过 cn_map（中文 → 英文）反向挂到球员上，中文输入直接匹配中文字段。
"""
import difflib
import re

_WORD_RE = re.compile(r"[^\w\u4e00-\u9fff]+")


def _norm(s: str) -> str:
    """小写 + 去掉点/撇号/连字符等（"ja'marr" → "jamarr"，"J." → "j"）。"""
    return _WORD_RE.sub("", (s or "").lower())


def _is_chinese(s: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in s)


def _cn_names_for(player_name: str, cn_map: dict) -> list:
    """从 中文→英文 映射表反查该球员的中文名（含别名）。"""
    out = []
    low = (player_name or "").lower()
    for cn, en in cn_map.items():
        en_l = en.lower()
        # 英文全名或 姓/姓+名首字母 粒度匹配（映射表里可能只有 "Wembanyama"）
        if en_l == low or en_l in low or low in en_l:
            out.append(cn)
    return out


def _fields(player: dict, cn_map: dict) -> list:
    """球员全部可搜索字段：英文名 / 缩写 / 名 / 姓 / 中文名。"""
    name = (player.get("name") or "").strip()
    fields = [name.lower()]
    short = (player.get("shortName") or "").strip()
    if short:
        fields.append(short.lower())
    for w in name.split():
        if len(w) > 1:
            fields.append(w.lower())
    for cn in _cn_names_for(name, cn_map):
        if cn not in fields:
            fields.append(cn)
    return [f for f in fields if f]


def _score_one(field_norm: str, q_norm: str) -> float:
    """单字段对单 query 的得分。"""
    if not field_norm or not q_norm:
        return 0.0
    if q_norm == field_norm:
        return 1.0
    if q_norm in field_norm:
        # 子串：覆盖字段比例越高越好（"wemby" vs "victorwembanyama" 得分低于 "wemby"）
        return 0.90 + 0.09 * (len(q_norm) / len(field_norm))
    if field_norm in q_norm:
        # 字段是 query 的一部分（全名 + 球队缩写等情况）
        return 0.80
    # 拼写容错
    return difflib.SequenceMatcher(None, q_norm, field_norm).ratio()


def score_player(player: dict, query: str, cn_map: dict) -> float:
    """球员对 query 的综合得分，0 表示不相关。"""
    q_norm = _norm(query)
    if not q_norm:
        return 0.0
    fields = [_norm(f) for f in _fields(player, cn_map)]
    fields = [f for f in fields if f]

    if _is_chinese(query.strip()):
        # 中文：整体匹配各字段（含中文名）
        return max((_score_one(f, q_norm) for f in fields), default=0.0)

    # 英文：按空格拆词，每词都需命中（顺序无关），总分取最弱词
    tokens = [t for t in (_norm(x) for x in query.split()) if t]
    if not tokens:
        return 0.0
    worst = 1.0
    for t in tokens:
        best_t = max((_score_one(f, t) for f in fields), default=0.0)
        if best_t < worst:
            worst = best_t
    return worst


def fuzzy_search(players: list, query: str, cn_map: dict, limit: int = 10, threshold: float = 0.55) -> list:
    """模糊搜索入口。返回按相关度排序的球员列表（附带 cnName 字段）。"""
    query = (query or "").strip()
    if not query:
        return []
    scored = []
    for p in players:
        s = score_player(p, query, cn_map)
        if s >= threshold:
            cns = _cn_names_for(p.get("name") or "", cn_map)
            enriched = {**p, "cnName": cns[0] if cns else None, "cnNames": cns}
            scored.append((s, enriched))
    scored.sort(key=lambda x: (-x[0], x[1].get("name", "")))
    return [p for _, p in scored[:limit]]


def parse_espn_search(d: dict, league_desc: str) -> list:
    """解析 ESPN search/v2 响应，提取指定联赛（"NBA"/"NFL"）的球员。

    用于本地 roster 缓存未命中时的在线兜底：roster 只含当前名单，
    交易/伤停/名单滞后会漏球员（如 Tyreek Hill 不在海豚 roster 里）。
    """
    out = []
    for grp in d.get("results", []):
        if grp.get("type") != "player":
            continue
        for c in grp.get("contents", []):
            if (c.get("description") or "").upper() != league_desc:
                continue
            uid = c.get("uid", "")
            aid = uid.split("~a:")[-1] if "~a:" in uid else ""
            name = c.get("displayName") or ""
            if not aid or not name:
                continue
            out.append({
                "id": aid,
                "name": name,
                "shortName": "",
                "team": "",          # 由调用方按 subtitle 映射缩写
                "teamName": c.get("subtitle") or "",
                "position": "",
                "_online": True,
            })
    return out
