// Finance 总览 v1.3 — 三块核心展示：年度收支表 + 资产表 + 资产负债率
import FinanceLayout from "./finance-layout";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Link } from "wouter";
import { Wallet, TrendingUp, TrendingDown, PieChart, Calendar } from "lucide-react";
import { API, type Metrics, type YearPoint, type YearlySummary, money, pct, fmt } from "./shared";
import { IncomeExpenseTrend } from "./components/Charts";

export default function FinanceOverview() {
  const { data: metrics } = useQuery<Metrics>({
    queryKey: ["finance-metrics"],
    queryFn: async () => (await fetch(API + "/metrics")).json(),
  });
  const { data: trends } = useQuery<YearPoint[]>({
    queryKey: ["finance-trends"],
    queryFn: async () => (await fetch(API + "/trends?years=5")).json(),
  });
  const { data: yearlySummary } = useQuery<YearlySummary[]>({
    queryKey: ["finance-yearly-summary"],
    queryFn: async () => (await fetch(API + "/summary/yearly")).json(),
  });

  const debtRatioPct = metrics ? metrics.debtRatio * 100 : 0;

  return (
    <FinanceLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wallet className="w-6 h-6 text-primary" />
            家庭财务
          </h1>
          <p className="text-sm text-muted-foreground mt-1">记录优先 · 三张表各记各的 · 自然语言记账 + 导入 + 查账</p>
        </div>

        {/* ② 资产表（三宫格卡片） */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1">
            <PieChart className="w-4 h-4" /> 资产表
            {metrics?.snapshotDate && <span className="text-xs text-muted-foreground ml-2">（快照 {metrics.snapshotDate}）</span>}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">总资产</div>
              <div className="text-2xl font-bold mt-1 text-emerald-600">{money(metrics?.totalAssets)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">总负债</div>
              <div className="text-2xl font-bold mt-1 text-red-600">{money(metrics?.totalLiabilities)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">净资产</div>
              <div className="text-2xl font-bold mt-1 text-primary">{money(metrics?.netAssets)}</div>
            </Card>
          </div>
        </div>

        {/* ③ 资产负债率（大数字 + 进度条） */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-muted-foreground">资产负债率</h2>
            <span className="text-xs text-muted-foreground">通用口径 = 总负债 / 总资产</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={"text-3xl font-bold " + (debtRatioPct > 50 ? "text-red-600" : debtRatioPct > 30 ? "text-amber-600" : "text-emerald-600")}>
              {debtRatioPct.toFixed(1)}%
            </span>
            {metrics && metrics.totalAssets > 0 && (
              <span className="text-xs text-muted-foreground">
                ({fmt(metrics.totalLiabilities, " 元")} / {fmt(metrics.totalAssets, " 元")})
              </span>
            )}
          </div>
          <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={"h-full rounded-full transition-all " + (debtRatioPct > 50 ? "bg-red-500" : debtRatioPct > 30 ? "bg-amber-500" : "bg-emerald-500")}
              style={{ width: Math.min(100, debtRatioPct) + "%" }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>0%</span><span>30%</span><span>50%</span><span>100%</span>
          </div>
        </Card>

        {/* ① 年度收支表 */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1">
            <Calendar className="w-4 h-4" /> 年度收支表
          </h2>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3">年份</th>
                  <th className="text-right p-3"><TrendingUp className="w-3.5 h-3.5 inline mr-1 text-emerald-500" />总收入</th>
                  <th className="text-right p-3"><TrendingDown className="w-3.5 h-3.5 inline mr-1 text-red-500" />总支出</th>
                  <th className="text-right p-3">年度净收入</th>
                </tr>
              </thead>
              <tbody>
                {(yearlySummary || []).length === 0 && (
                  <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">暂无年度数据</td></tr>
                )}
                {(yearlySummary || []).map((y) => (
                  <tr key={y.year} className="border-t border-border/50 hover:bg-muted/30">
                    <td className="p-3 font-medium">{y.year}</td>
                    <td className="p-3 text-right text-emerald-600">{money(y.income)}</td>
                    <td className="p-3 text-right text-red-600">{money(y.expense)}</td>
                    <td className={"p-3 text-right font-medium " + (y.surplus >= 0 ? "text-emerald-600" : "text-red-600")}>
                      {money(y.surplus)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        {/* 辅助：收支年度趋势折线图（保留） */}
        <Card className="p-4">
          <h3 className="font-semibold mb-2">收支年度趋势</h3>
          <IncomeExpenseTrend data={trends || []} />
        </Card>

        {/* 快捷入口 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="收入记录" value={0} href="/finance/income" />
          <StatCard label="支出记录" value={0} href="/finance/expense" />
          <StatCard label="资产负债快照" value={0} href="/finance/net-worth" />
          <StatCard label="教育基金" value={0} href="/finance/education-fund" />
          <StatCard label="债务明细" value={0} href="/finance/debt" />
        </div>
      </div>
    </FinanceLayout>
  );
}

function StatCard({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href}>
      <Card className="p-3 hover:bg-accent transition-colors cursor-pointer">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-bold mt-1">{fmt(value, " 条")}</div>
      </Card>
    </Link>
  );
}
