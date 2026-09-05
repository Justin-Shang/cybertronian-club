#!/usr/bin/env python3
"""
Fetch A-share stock metrics via AKShare (v1.18+).
Usage:
  python3 akshare_fetch.py <code>             # 基础指标 + PE/PB 5年分位
  python3 akshare_fetch.py <code> extra       # 5 个扩展数据源（研报/公告/两融/解禁/股东户数）
Output: JSON object with available metrics, null for unavailable fields.

API references (verified 2026-08, akshare v1.18.63):
  stock_value_em(symbol)                  → 历史估值（PE/PB/市值）
  stock_financial_abstract_ths(symbol)     → 季度财务摘要
  stock_info_a_code_name()                 → 代码→名称静态映射
  stock_research_report_em(symbol)         → 研报（报告名称/东财评级/机构/日期/盈利预测）
  stock_notice_report(symbol, date)        → 公告（单日，symbol='全部'取全市场再按代码过滤）
  stock_margin_detail_sse(date)            → 上交所两融（全市场单日，按代码过滤）
  stock_margin_detail_szse(date)           → 深交所两融（同上）
  stock_restricted_release_summary_em(...) → 解禁汇总（市场级，非个股）
  stock_zh_a_gdhs_detail_em(symbol)        → 股东户数变化（个股历史）
"""
import sys
import json
import bisect
import warnings
warnings.filterwarnings("ignore")

try:
    import pandas as pd
except ImportError:
    pd = None


def safe_float(val, scale=1.0):
    try:
        v = float(str(val).strip().replace("%", "").replace(",", ""))
        result = round(v * scale, 4)
        return None if result != result else result  # NaN guard
    except Exception:
        return None


def parse_pct_str(val):
    """Parse a percentage string like '32.53%' → 0.3253 (decimal)."""
    try:
        v = float(str(val).strip().replace("%", "").replace(",", ""))
        result = round(v / 100, 4)
        return None if result != result else result
    except Exception:
        return None


def _percentile(sorted_vals, p):
    """简单百分位计算（不依赖 numpy）。线性插值法。"""
    if not sorted_vals:
        return None
    n = len(sorted_vals)
    if n == 1:
        return sorted_vals[0]
    k = (p / 100) * (n - 1)
    f = int(k)
    c = k - f
    if f + 1 < n:
        return sorted_vals[f] + (sorted_vals[f + 1] - sorted_vals[f]) * c
    return sorted_vals[f]


def calculate_percentile(df, col, current_val, years=5):
    """计算当前值在近 N 年历史数据中的分位（0-100）和区间带。"""
    if df is None or len(df) == 0 or current_val is None or pd is None:
        return None, None
    try:
        df = df.copy()
        if "数据日期" in df.columns:
            df["__d"] = pd.to_datetime(df["数据日期"], errors="coerce")
            cutoff = pd.Timestamp.now() - pd.Timedelta(days=365 * years)
            df = df[df["__d"].notna() & (df["__d"] >= cutoff)]
        if col not in df.columns:
            return None, None
        series = df[col].apply(safe_float).dropna()
        if len(series) < 10:
            return None, None
        sorted_vals = sorted(series.tolist())
        n = len(sorted_vals)
        idx = bisect.bisect_left(sorted_vals, current_val)
        percentile = round((idx / n) * 100, 2)
        band = {
            "min": round(min(sorted_vals), 2),
            "p20": round(_percentile(sorted_vals, 20), 2),
            "p50": round(_percentile(sorted_vals, 50), 2),
            "p80": round(_percentile(sorted_vals, 80), 2),
            "max": round(max(sorted_vals), 2),
        }
        return percentile, band
    except Exception:
        return None, None


def fetch_basic(code):
    """获取基础指标 + 估值分位。"""
    try:
        import akshare as ak
    except ImportError:
        print(json.dumps({"error": "akshare not installed — run: pip install akshare"}))
        sys.exit(1)

    result = {
        "pe_ttm": None, "pb": None, "ps": None,
        "roe": None, "gross_margin": None, "net_margin": None,
        "revenue_yoy": None, "profit_yoy": None,
        "operating_cashflow": None, "debt_to_equity": None,
        "dividend_yield": None, "market_cap": None,
        "price": None, "price_change_pct": None,
        "name": None, "industry": None,
        "pe_percentile": None, "pe_band": None,
        "pb_percentile": None, "pb_band": None,
    }
    errors = []

    # ── 1. Stock name from static mapping ──────────────────────────────────
    try:
        name_df = ak.stock_info_a_code_name()
        if name_df is not None and len(name_df) > 0:
            cols = name_df.columns.tolist()
            code_col, name_col = cols[0], cols[1] if len(cols) > 1 else None
            if name_col:
                match = name_df[name_df[code_col].astype(str).str.strip() == code]
                if len(match) > 0:
                    result["name"] = str(match.iloc[0][name_col]).strip() or None
    except Exception as e:
        errors.append(f"stock_info_a_code_name: {e}")

    # ── 2. Valuation & price via stock_value_em（含 5 年分位计算） ─────────
    try:
        val_df = ak.stock_value_em(symbol=code)
        if val_df is not None and len(val_df) > 0:
            last = val_df.iloc[-1]
            result["price"]            = safe_float(last.get("当日收盘价"))
            result["price_change_pct"] = safe_float(last.get("当日涨跌幅"))
            result["pe_ttm"]           = safe_float(last.get("PE(TTM)"))
            result["pb"]               = safe_float(last.get("市净率"))
            result["ps"]               = safe_float(last.get("市销率"))
            result["market_cap"]       = safe_float(last.get("总市值"), scale=1 / 1e8)

            pe_p, pe_b = calculate_percentile(val_df, "PE(TTM)", result["pe_ttm"], years=5)
            pb_p, pb_b = calculate_percentile(val_df, "市净率", result["pb"], years=5)
            result["pe_percentile"] = pe_p
            result["pe_band"] = pe_b
            result["pb_percentile"] = pb_p
            result["pb_band"] = pb_b
    except Exception as e:
        errors.append(f"stock_value_em: {e}")

    # ── 3. Financial ratios via stock_financial_abstract_ths ───────────────
    try:
        fin_df = ak.stock_financial_abstract_ths(symbol=code, indicator="按报告期")
        if fin_df is not None and len(fin_df) > 0:
            recent = fin_df.iloc[-1]
            result["roe"]          = parse_pct_str(recent.get("净资产收益率"))
            result["gross_margin"] = parse_pct_str(recent.get("销售毛利率"))
            result["net_margin"]   = parse_pct_str(recent.get("销售净利率"))
            result["revenue_yoy"]  = parse_pct_str(recent.get("营业总收入同比增长率"))
            result["profit_yoy"]   = parse_pct_str(recent.get("净利润同比增长率"))
            for key in ("经营现金流", "经营活动产生的现金流量净额", "现金流量净额"):
                v = safe_float(recent.get(key))
                if v is not None:
                    result["operating_cashflow"] = v
                    break
            for key in ("资产负债率", "资产负债比率"):
                v = parse_pct_str(recent.get(key))
                if v is not None:
                    result["debt_to_equity"] = v
                    break
    except Exception as e:
        errors.append(f"stock_financial_abstract_ths: {e}")

    all_null = all(v is None for k, v in result.items()
                   if k not in ("pe_percentile", "pe_band", "pb_percentile", "pb_band"))
    if all_null and errors:
        net_keywords = ("ConnectionError", "RemoteDisconnected", "timeout",
                        "ConnectTimeout", "ReadTimeout", "Connection aborted")
        is_network = any(any(kw in str(e) for kw in net_keywords) for e in errors)
        hint = (
            " (网络不可达：请在能访问中国金融 API 的服务器上运行)"
            if is_network else ""
        )
        print(json.dumps({"error": f"所有数据源均失败{hint}",
                          "details": [str(e) for e in errors[:3]]}))
        sys.exit(1)

    return result


def _pick_col(cols, *candidates):
    """从候选列名中挑出第一个存在的列。"""
    for c in candidates:
        if c in cols:
            return c
    return None


def fetch_market():
    """全 A 股实时行情快照（用于每周初筛股票池）。调 stock_zh_a_spot_em，基础过滤 ST/小市值/亏损。"""
    try:
        import akshare as ak
    except ImportError:
        print(json.dumps({"error": "akshare not installed"}))
        sys.exit(1)
    try:
        df = ak.stock_zh_a_spot_em()
    except Exception as e:
        # 2026-08-29: 东财 push2 IP 封禁时降级为 新浪全A代码列表 + 腾讯批量行情
        rows = _fetch_market_tencent_fallback()
        if rows is None:
            print(json.dumps({"error": f"stock_zh_a_spot_em failed: {e}; tencent fallback also failed"}))
            sys.exit(1)
        print(json.dumps(rows, ensure_ascii=False, default=str))
        return
    if df is None or len(df) == 0:
        print(json.dumps([]))
        return
    cols = df.columns.tolist()
    code_col = _pick_col(cols, "代码", "股票代码", "code")
    name_col = _pick_col(cols, "名称", "股票名称", "name")
    price_col = _pick_col(cols, "最新价", "收盘价", "price")
    pct_col = _pick_col(cols, "涨跌幅", "涨跌幅度")
    pe_col = _pick_col(cols, "市盈率-动态", "市盈率", "pe", "pe_ttm")
    pb_col = _pick_col(cols, "市净率", "pb")
    mcap_col = _pick_col(cols, "总市值", "总市值(元)")
    rows = []
    for _, r in df.iterrows():
        name = str(r[name_col]).strip() if name_col else ""
        if "ST" in name or "st" in name:
            continue
        code = str(r[code_col]).strip().zfill(6) if code_col else ""
        if not code or len(code) != 6:
            continue
        pe = safe_float(r[pe_col]) if pe_col else None
        if pe is None or pe <= 0:
            continue
        price = safe_float(r[price_col]) if price_col else None
        if price is None or price <= 0:
            continue
        mcap = safe_float(r[mcap_col], scale=1/1e8) if mcap_col else None
        if mcap is None or mcap < 50:
            continue
        rows.append({
            "code": code, "name": name, "price": price, "peTtm": pe,
            "pb": safe_float(r[pb_col]) if pb_col else None,
            "marketCap": mcap,
            "priceChangePct": safe_float(r[pct_col]) if pct_col else None,
        })
    print(json.dumps(rows, ensure_ascii=False, default=str))



def _fetch_market_tencent_fallback():
    """东财封禁时的降级管道：新浪全A代码列表 + 腾讯批量行情（PE/PB/市值）。
    2026-08-29 实测：新浪 5550 只 ~10s，腾讯 40只/批 ~35s，全市场约 45s。"""
    try:
        import akshare as ak
        import urllib.request
        import time
    except ImportError:
        return None
    try:
        spot = ak.stock_zh_a_spot()  # 列: 代码(带 sh/sz/bj 前缀), 名称, 最新价, 涨跌幅...
    except Exception:
        return None
    if spot is None or len(spot) == 0:
        return None
    codes = [str(c).strip() for c in spot["代码"].tolist()]
    rows = []
    for i in range(0, len(codes), 40):
        batch = codes[i:i+40]
        url = "https://qt.gtimg.cn/q=" + ",".join(batch)
        try:
            req = urllib.request.Request(url, headers={"Referer": "https://gu.qq.com"})
            raw = urllib.request.urlopen(req, timeout=10).read().decode("gbk", errors="ignore")
        except Exception:
            time.sleep(1.0)
            continue
        for line in raw.strip().split(";"):
            if "~" not in line or "=" not in line:
                continue
            parts = line.split("~")
            if len(parts) < 46:
                continue
            code6 = parts[2].strip()
            if not code6 or len(code6) != 6:
                continue
            name = parts[1].strip()
            if "ST" in name or "st" in name:
                continue
            price = safe_float(parts[3])
            if price is None or price <= 0:
                continue
            pe = safe_float(parts[39])
            if pe is None or pe <= 0:
                continue
            mcap = safe_float(parts[45])  # 腾讯总市值单位：亿元
            if mcap is None or mcap < 50:
                continue
            pb = safe_float(parts[46]) if len(parts) > 46 else None
            pct = safe_float(parts[32])
            rows.append({
                "code": code6, "name": name, "price": price, "peTtm": pe,
                "pb": pb, "marketCap": mcap, "priceChangePct": pct,
            })
        time.sleep(0.1)
    return rows


def fetch_extra(code):
    """获取 5 个扩展数据源（各自独立降级）。"""
    try:
        import akshare as ak
    except ImportError:
        print(json.dumps({"error": "akshare not installed"}))
        sys.exit(1)

    extra = {
        "research_reports": [],
        "announcements": [],
        "margin": {},
        "lockup": [],
        "holders": [],
        "_degraded": [],
    }

    now = pd.Timestamp.now() if pd else None
    today_str = now.strftime("%Y%m%d") if now else None

    # ── 1. 研报 ────────────────────────────────────────────────────────────
    try:
        reports = ak.stock_research_report_em(symbol=code)
        if reports is not None and len(reports) > 0:
            cols = reports.columns.tolist()
            title_col = _pick_col(cols, "报告名称", "标题", "research_report_title")
            org_col = _pick_col(cols, "机构", "机构名称")
            rating_col = _pick_col(cols, "东财评级", "评级")
            date_col = _pick_col(cols, "日期", "发布日期")
            eps_col = _pick_col(cols, "2026-盈利预测-收益", "2025-盈利预测-收益", "2024-盈利预测-收益")
            pe_col = _pick_col(cols, "2026-盈利预测-市盈率", "2025-盈利预测-市盈率", "2024-盈利预测-市盈率")
            rows = []
            for _, r in reports.head(8).iterrows():
                rows.append({
                    "title": str(r[title_col]).strip() if title_col else None,
                    "org": str(r[org_col]).strip() if org_col else None,
                    "rating": str(r[rating_col]).strip() if rating_col else None,
                    "targetPrice": None,  # 东财研报接口无目标价字段
                    "epsForecast": safe_float(r[eps_col]) if eps_col else None,
                    "peForecast": safe_float(r[pe_col]) if pe_col else None,
                    "date": str(r[date_col]).strip() if date_col else None,
                })
            extra["research_reports"] = rows
    except Exception as e:
        extra["_degraded"].append({"source": "research_reports", "reason": str(e)[:120]})

    # ── 2. 公告（stock_notice_report 取单日全市场，再过滤） ────────────────
    try:
        # 取最近 7 天的公告（逐日尝试，最多 3 天）
        notices_rows = []
        for days_ago in range(0, 7):
            d = (now - pd.Timedelta(days=days_ago)).strftime("%Y%m%d")
            try:
                df = ak.stock_notice_report(symbol="全部", date=d)
                if df is None or len(df) == 0:
                    continue
                cols = df.columns.tolist()
                code_col = _pick_col(cols, "股票代码", "代码", "code")
                title_col = _pick_col(cols, "公告标题", "标题", "title")
                date_col = _pick_col(cols, "公告日期", "日期", "date")
                if code_col:
                    sub = df[df[code_col].astype(str).str.strip() == code]
                    for _, r in sub.iterrows():
                        notices_rows.append({
                            "title": str(r[title_col]).strip() if title_col else None,
                            "date": str(r[date_col]).strip() if date_col else d,
                        })
            except Exception:
                continue
            if len(notices_rows) >= 5:
                break
        extra["announcements"] = notices_rows[:8]
    except Exception as e:
        extra["_degraded"].append({"source": "announcements", "reason": str(e)[:120]})

    # ── 3. 融资融券（按交易所分别取全市场单日数据再过滤） ──────────────────
    try:
        margin_data = {}
        # 尝试最近 3 个交易日
        for days_ago in range(0, 5):
            d = (now - pd.Timedelta(days=days_ago)).strftime("%Y%m%d")
            try:
                if code.startswith("6"):
                    df = ak.stock_margin_detail_sse(date=d)
                else:
                    df = ak.stock_margin_detail_szse(date=d)
                if df is None or len(df) == 0:
                    continue
                cols = df.columns.tolist()
                code_col = _pick_col(cols, "股票代码", "代码", "code")
                if not code_col:
                    continue
                sub = df[df[code_col].astype(str).str.strip() == code]
                if len(sub) == 0:
                    continue
                last = sub.iloc[0]
                margin_data = {
                    "date": d,
                    "financeBalance": safe_float(last.get("融资余额") or last.get("融资余额(元)")),
                    "financeBuy": safe_float(last.get("融资买入额") or last.get("融资买入额(元)")),
                    "securitiesBalance": safe_float(last.get("融券余额") or last.get("融券余额(元)")),
                    "source": "sse" if code.startswith("6") else "szse",
                }
                break
            except Exception:
                continue
        extra["margin"] = margin_data
    except Exception as e:
        extra["_degraded"].append({"source": "margin", "reason": str(e)[:120]})

    # ── 4. 解禁（市场级汇总，标注该股票是否有近 30 天解禁） ────────────────
    try:
        # stock_restricted_release_summary_em 是市场级聚合，无个股明细。
        # 这里仅返回全市场近 30 天汇总，个股明细需用其他接口。
        start = today_str
        end = (now + pd.Timedelta(days=30)).strftime("%Y%m%d") if now else None
        lockup_df = ak.stock_restricted_release_summary_em(
            symbol="全部股票", start_date=start, end_date=end
        )
        if lockup_df is not None and len(lockup_df) > 0:
            # 取最近 5 个有解禁的日期汇总
            cols = lockup_df.columns.tolist()
            date_col = _pick_col(cols, "解禁时间", "日期")
            count_col = _pick_col(cols, "当日解禁股票家数")
            amt_col = _pick_col(cols, "实际解禁数量")
            val_col = _pick_col(cols, "实际解禁市值")
            rows = []
            for _, r in lockup_df.head(5).iterrows():
                rows.append({
                    "date": str(r[date_col]).strip() if date_col else None,
                    "marketCount": safe_float(r[count_col]) if count_col else None,
                    "marketAmount": safe_float(r[amt_col]) if amt_col else None,
                    "marketValue": safe_float(r[val_col]) if val_col else None,
                    "code": None,  # 个股级数据需另外接口
                    "note": "市场级汇总，非个股数据",
                })
            extra["lockup"] = rows
        # 标注：个股解禁明细需查 stock_restricted_release_detail_em（如果存在）
    except Exception as e:
        extra["_degraded"].append({"source": "lockup", "reason": str(e)[:120]})

    # ── 5. 股东户数 ────────────────────────────────────────────────────────
    try:
        holders = ak.stock_zh_a_gdhs_detail_em(symbol=code)
        if holders is not None and len(holders) > 0:
            cols = holders.columns.tolist()
            date_col = _pick_col(cols, "股东户数统计截止日", "截止日期")
            curr_col = _pick_col(cols, "股东户数-本次", "股东户数")
            prev_col = _pick_col(cols, "股东户数-上次")
            chg_col = _pick_col(cols, "股东户数-增减比例", "环比增长率")
            chg_abs_col = _pick_col(cols, "股东户数-增减")
            avg_hold_col = _pick_col(cols, "户均持股数量", "户均流通股")
            avg_val_col = _pick_col(cols, "户均持股市值")
            rows = []
            for _, r in holders.head(5).iterrows():
                rows.append({
                    "date": str(r[date_col]).strip() if date_col else None,
                    "holders": safe_float(r[curr_col]) if curr_col else None,
                    "prevHolders": safe_float(r[prev_col]) if prev_col else None,
                    "change": safe_float(r[chg_col]) if chg_col else None,
                    "changeAbs": safe_float(r[chg_abs_col]) if chg_abs_col else None,
                    "avgHold": safe_float(r[avg_hold_col]) if avg_hold_col else None,
                    "avgValue": safe_float(r[avg_val_col]) if avg_val_col else None,
                })
            extra["holders"] = rows
    except Exception as e:
        extra["_degraded"].append({"source": "holders", "reason": str(e)[:120]})

    return extra


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: akshare_fetch.py <6-digit-code> [extra]"}))
        sys.exit(1)

    first = sys.argv[1].strip()
    mode = sys.argv[2].strip() if len(sys.argv) > 2 else ""

    # 2026-08-29: Node 端 spawn 传 [script, "market"]（单参数），兼容两种调用约定
    if first == "market" or mode == "market":
        fetch_market()
    elif mode == "extra":
        code = first.zfill(6)
        result = fetch_extra(code)
        print(json.dumps(result, ensure_ascii=False, default=str))
    else:
        code = first.zfill(6)
        result = fetch_basic(code)
        print(json.dumps(result, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
