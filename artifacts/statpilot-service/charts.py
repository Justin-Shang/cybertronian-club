"""图表生成 — matplotlib Agg，输出 base64 PNG。

中文支持：优先使用系统中文字体（Noto Sans CJK / SimHei），
找不到则回退英文标注（LLM 解读仍为中文）。
"""
import base64
import io
import logging
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

logger = logging.getLogger("statpilot.charts")

plt.rcParams["font.family"] = "sans-serif"

_CJK_CANDIDATES = [
    "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC",
    "PingFang SC", "Microsoft YaHei", "SimHei", "WenQuanYi Zen Hei", "AR PL UMing CN",
]


def setup_font():
    from matplotlib import font_manager
    installed = {f.name for f in font_manager.fontManager.ttflist}
    for name in _CJK_CANDIDATES:
        if name in installed:
            plt.rcParams["font.family"] = name
            plt.rcParams["axes.unicode_minus"] = False
            return name
    return None


def health() -> str:
    return setup_font() or "no-cjk (english labels)"


def _b64(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=140, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


# ---------- NBA 投篮热图 ----------

def nba_shotchart(shots: list[dict], player: str, team: str, season: str) -> str:
    setup_font()
    fig, ax = plt.subplots(figsize=(8.2, 7.0))
    # 半场尺寸（英尺）：94x50，篮筐在 (0,0) 附近，这里取进攻半场右半
    ax.set_xlim(-25, 25)
    ax.set_ylim(-6, 44)
    ax.set_aspect("equal")
    ax.set_facecolor("#f7f4ee")
    # 场地线
    _draw_court(ax)

    xs = np.array([s["x"] for s in shots], dtype=float)
    ys = np.array([s["y"] for s in shots], dtype=float)
    made = np.array([s["made"] for s in shots], dtype=bool)

    # 网格聚合：2.5ft 网格 → 命中率色块
    gx, gy = 2.5, 2.5
    bins_x = np.arange(-25, 25.01, gx)
    bins_y = np.arange(-6, 44.01, gy)
    H_total, _, _ = np.histogram2d(xs, ys, bins=[bins_x, bins_y])
    H_made, _, _ = np.histogram2d(xs[made], ys[made], bins=[bins_x, bins_y])
    with np.errstate(divide="ignore", invalid="ignore"):
        pct = np.where(H_total > 0, H_made / np.where(H_total > 0, H_total, 1), np.nan)

    cmap = plt.cm.RdYlBu_r  # 蓝(低)→红(高)命中率
    masked = np.ma.masked_invalid(pct)
    img = ax.imshow(masked.T, origin="lower", extent=[-25, 25, -6, 44],
                    cmap=cmap, vmin=0.2, vmax=0.65, alpha=0.85, aspect="equal")

    # 出手数标注（只标出手 >= 10 的格）
    cx = (bins_x[:-1] + bins_x[1:]) / 2
    cy = (bins_y[:-1] + bins_y[1:]) / 2
    for i in range(len(cx)):
        for j in range(len(cy)):
            if H_total[i, j] >= 10:
                ax.text(cx[i], cy[j], str(int(H_total[i, j])), ha="center", va="center",
                        fontsize=5.5, color="#444", alpha=0.75)

    cb = fig.colorbar(img, ax=ax, fraction=0.03, pad=0.02)
    cb.set_label("命中率", fontsize=9)
    cb.ax.tick_params(labelsize=7)

    total = int(len(shots))
    made_n = int(made.sum())
    ax.set_title(f"{player} · {team} · {season} — 投篮分布 (命中率，出手数 ≥10 标注)", fontsize=11, pad=10)
    ax.set_xlabel(f"总出手 {total} · 命中 {made_n} · 命中率 {made_n/total*100:.1f}%", fontsize=9)
    ax.axis("off")
    return _b64(fig)


def _draw_court(ax):
    """简化半场轮廓：三分线、禁区、篮筐。"""
    import matplotlib.patches as mpatches
    # 三分线（近似两段弧 + 底线）
    theta = np.linspace(np.deg2rad(180), np.deg2rad(360), 100)
    ax.plot(22 * np.cos(theta), 22 * np.sin(theta) - 5.25, color="#333", lw=1.2)
    # 侧边三分线延长
    ax.plot([-22, -22], [-5.25, -1.0], color="#333", lw=1.2)
    ax.plot([22, 22], [-5.25, -1.0], color="#333", lw=1.2)
    # 底线
    ax.plot([-25, 25], [-5.25, -5.25], color="#333", lw=1.2)
    # 边线
    ax.plot([-25, -25], [-5.25, 44], color="#333", lw=1.0)
    ax.plot([25, 25], [-5.25, 44], color="#333", lw=1.0)
    ax.plot([-25, 25], [44, 44], color="#333", lw=1.0)
    # 禁区（paint）
    ax.add_patch(mpatches.Rectangle((-8, -5.25), 16, 19, fill=False, edgecolor="#333", lw=1.0))
    # 罚球圈
    ax.add_patch(mpatches.Circle((0, 13.75), 6, fill=False, edgecolor="#333", lw=1.0))
    # 篮筐
    ax.add_patch(mpatches.Circle((0, 0), 1.5, fill=False, edgecolor="#d22", lw=1.5))
    ax.plot([0, 0], [0, 1.5], color="#d22", lw=1.5)


# ---------- NBA 投篮构成 ----------

def nba_shooting(player: str, team: str, season: int, data: dict) -> str:
    setup_font()
    three, two, ft = data["three"], data["two"], data["freeThrow"]
    labels = ["三分", "两分", "罚球"]
    attempted = [three["attempted"], two["attempted"], ft["attempted"]]
    made = [three["made"], two["made"], ft["made"]]
    pcts = [three["pct"], two["pct"], ft["pct"]]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.5, 3.6))
    x = np.arange(len(labels))
    b1 = ax1.bar(x, attempted, color="#93c5fd", width=0.5, label="出手")
    b2 = ax1.bar(x, made, color="#2563eb", width=0.5, label="命中")
    for xi in x:
        ax1.text(xi, attempted[xi] + max(attempted) * 0.03, str(attempted[xi]), ha="center", fontsize=9)
    ax1.set_xticks(x)
    ax1.set_xticklabels(labels)
    ax1.set_title("出手 / 命中", fontsize=10)
    ax1.legend(fontsize=8)
    ax1.spines[["top", "right"]].set_visible(False)

    colors = ["#16a34a" if (p or 0) >= 35 else "#f59e0b" if (p or 0) >= 30 else "#dc2626" for p in pcts]
    b = ax2.bar(x, [p or 0 for p in pcts], color=colors, width=0.5)
    for bar, p in zip(b, pcts):
        ax2.text(bar.get_x() + bar.get_width() / 2, (p or 0) + 1.5, f"{p:.1f}%", ha="center", fontsize=10)
    ax2.set_xticks(x)
    ax2.set_xticklabels(labels)
    ax2.set_ylim(0, max([p or 0 for p in pcts]) + 10)
    ax2.set_title(f"命中率  eFG {data.get('eFgPct', 0):.1f}% · TS {data.get('tsPct', 0):.1f}%", fontsize=10)
    ax2.spines[["top", "right"]].set_visible(False)

    fig.suptitle(f"{player} · {team} · {season}赛季 — 投篮构成", fontsize=11)
    fig.tight_layout()
    return _b64(fig)


# ---------- NBA 单场比分走势 ----------

def nba_game_linescore(name: str, linescore: list[dict]) -> str:
    """按节比分柱状图：每队每节得分。"""
    setup_font()
    # 过滤无效记录（period/pts 缺失）
    rows = [ls for ls in linescore if ls.get("period") is not None and ls.get("pts") is not None]
    if not rows:
        return None
    df = {}
    for ls in rows:
        df.setdefault(ls["team"], []).append((int(ls["period"]), int(ls["pts"])))
    teams = list(df.keys())
    periods = sorted({p for _, p in df[teams[0]]}) if teams else []
    if not periods:
        return None
    fig, ax = plt.subplots(figsize=(8, 3.4))
    w = 0.38
    for i, t in enumerate(teams):
        pts = {p: v for p, v in df[t]}
        xs = np.arange(len(periods)) + i * w
        ax.bar(xs, [pts.get(p, 0) for p in periods], width=w, label=t, color=["#2563eb", "#dc2626"][i % 2])
        for xi, v in zip(xs, [pts.get(p, 0) for p in periods]):
            ax.text(xi, v + 1, str(int(v)), ha="center", fontsize=7.5)
    ax.set_xticks(np.arange(len(periods)) + w / 2)
    ax.set_xticklabels([f"第{p}节" for p in periods])
    ax.legend(fontsize=9)
    ax.set_title(f"{name} — 分节比分走势", fontsize=11)
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    return _b64(fig)


# ---------- NBA On/Off ----------

def nba_onoff(player: str, team: str, season: str, on: dict, off: dict, diff: float) -> str:
    setup_font()
    labels = ["在场", "不在场"]
    on_vals = [on["net"], off["net"]]
    fig, ax = plt.subplots(figsize=(7.5, 3.2))
    bars = ax.bar(labels, on_vals, color=["#2563eb", "#9ca3af"], width=0.45)
    for b, v in zip(bars, on_vals):
        ax.text(b.get_x() + b.get_width() / 2, v + (0.3 if v >= 0 else -0.9),
                f"{v:+.1f}", ha="center", fontsize=11, fontweight="bold")
    ax.axhline(0, color="#333", lw=0.8)
    ax.set_ylim(min(on_vals) - 3, max(on_vals) + 3)
    ax.set_ylabel("净效率 (Net Rating)", fontsize=9)
    ax.set_title(f"{player} · {team} · {season} — 在场 vs 不在场净效率  (差值 {diff:+.1f})", fontsize=10)
    ax.spines[["top", "right"]].set_visible(False)
    ax.tick_params(labelsize=9)
    return _b64(fig)


# ---------- NBA 护框 / 防守 ----------

def nba_defense(team: str, season: str, categories: list[dict]) -> str:
    setup_font()
    cats = [c for c in categories if c["dfga"] > 0]
    labels = [c["category"] for c in cats]
    pcts = [c["dfgPct"] or 0 for c in cats]
    fig, ax = plt.subplots(figsize=(7.5, 3.6))
    colors = ["#16a34a" if p <= 44 else ("#f59e0b" if p <= 50 else "#dc2626") for p in pcts]
    bars = ax.bar(labels, pcts, color=colors, width=0.55)
    for b, c in zip(bars, cats):
        ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 0.6,
                f'{c["dfgPct"]:.1f}%  ({c["dfga"]}次)', ha="center", fontsize=8)
    ax.set_ylabel("对手命中率 DFG%", fontsize=9)
    ax.set_title(f"{team} · {season} — 防守区域对手命中率（越低越好）", fontsize=10)
    ax.set_ylim(0, max(pcts) + 8)
    ax.spines[["top", "right"]].set_visible(False)
    plt.xticks(rotation=15, fontsize=8)
    return _b64(fig)


# ---------- NFL 传球分布 ----------

def nfl_receiving(player: str, season: int, dist: list[dict]) -> str:
    setup_font()
    loc_map = {"left": "左路", "middle": "中路", "right": "右路", None: "未知", "NA": "未知"}
    labels = [loc_map.get(str(r["location"]), str(r["location"])) for r in dist]
    targets = [r["targets"] for r in dist]
    epas = [r["totalEpa"] for r in dist]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.5, 3.4))
    b1 = ax1.bar(labels, targets, color="#2563eb", width=0.5)
    for b, t in zip(b1, targets):
        ax1.text(b.get_x() + b.get_width() / 2, t + 0.5, str(int(t)), ha="center", fontsize=10)
    ax1.set_title("传球目标数", fontsize=10)
    ax1.set_ylim(0, max(targets) + 3)
    ax1.spines[["top", "right"]].set_visible(False)
    b2 = ax2.bar(labels, epas, color=["#16a34a" if e >= 0 else "#dc2626" for e in epas], width=0.5)
    for b, e in zip(b2, epas):
        ax2.text(b.get_x() + b.get_width() / 2, e + (0.4 if e >= 0 else -1.4), f"{e:+.1f}", ha="center", fontsize=9)
    ax2.set_title("按方向 EPA", fontsize=10)
    ax2.axhline(0, color="#333", lw=0.8)
    ax2.spines[["top", "right"]].set_visible(False)
    fig.suptitle(f"{player} · {season}赛季 — 接球方向分布", fontsize=11)
    fig.tight_layout()
    return _b64(fig)


# ---------- NFL EPA 柱状 ----------

def nfl_epa(player: str, season: int, total_epa: float, pass_epa: float, rush_epa: float) -> str:
    setup_font()
    labels = ["合计", "传球", "冲球"]
    vals = [total_epa, pass_epa, rush_epa]
    fig, ax = plt.subplots(figsize=(6.5, 3.0))
    colors = ["#2563eb", "#16a34a", "#f59e0b"]
    b = ax.bar(labels, vals, color=colors, width=0.45)
    for bar, v in zip(b, vals):
        ax.text(bar.get_x() + bar.get_width() / 2, v + (0.5 if v >= 0 else -1.5), f"{v:+.1f}", ha="center", fontsize=11, fontweight="bold")
    ax.axhline(0, color="#333", lw=0.8)
    ax.set_ylim(min(vals) - 5, max(vals) + 5)
    ax.set_title(f"{player} · {season}赛季 — EPA 贡献", fontsize=11)
    ax.spines[["top", "right"]].set_visible(False)
    return _b64(fig)
