// Finance 图表组件（recharts 封装）
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, ReferenceDot, ReferenceLine, ComposedChart, Area, Bar } from "recharts";
import { Card } from "@/components/ui/card";
import { fmt, pct, money } from "../shared";

const COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#6366f1"];

// 收支趋势折线图
export function IncomeExpenseTrend({ data }: { data: Array<{ year: number; income: number; expense: number; surplus: number }> }) {
  if (data.length === 0) return <div className="text-sm text-muted-foreground py-8 text-center">暂无趋势数据</div>;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis dataKey="year" tick={{ fontSize: 12 }} />
        <YAxis tickFormatter={(v) => fmt(v / 10000, "万")} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v: number) => money(v)} />
        <Legend />
        <Line type="monotone" dataKey="income" name="收入" stroke="#10b981" strokeWidth={2} />
        <Line type="monotone" dataKey="expense" name="支出" stroke="#ef4444" strokeWidth={2} />
        <Line type="monotone" dataKey="surplus" name="结余" stroke="#3b82f6" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// 分类占比饼图
export function CategoryPie({ data }: { data: Array<{ name: string; value: number }> }) {
  const filtered = data.filter((d) => d.value > 0);
  if (filtered.length === 0) return <div className="text-sm text-muted-foreground py-8 text-center">暂无分类数据</div>;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie data={filtered} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e) => e.name + " " + fmt(e.value / 10000, "万")}>
          {filtered.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v: number) => money(v)} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// 综合指标四宫格
export function MetricsDashboard({ metrics }: { metrics: import("../shared").Metrics | undefined }) {
  if (!metrics) return <div className="text-sm text-muted-foreground py-4">加载中...</div>;
  const cards = [
    { label: "净资产", value: money(metrics.netAssets), sub: metrics.snapshotDate ? "截至 " + metrics.snapshotDate : "" },
    { label: "资产负债率", value: pct(metrics.debtRatio), sub: fmt(metrics.totalLiabilities / 10000, "万负债") },
    { label: "房产占比", value: pct(metrics.realEstateRatio), sub: "流动 " + pct(metrics.cashRatio) },
    { label: "年度储蓄率", value: pct(metrics.yearlySavingRate), sub: "结余 " + fmt(metrics.yearlySurplus / 10000, "万") },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <Card key={c.label} className="p-4">
          <div className="text-xs text-muted-foreground">{c.label}</div>
          <div className="text-xl font-bold mt-1">{c.value}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{c.sub}</div>
        </Card>
      ))}
    </div>
  );
}

// 净资产年度趋势线
export function NetWorthTrend({ data }: { data: Array<{ year: number; netAssets: number }> }) {
  if (data.length === 0) return <div className="text-sm text-muted-foreground py-8 text-center">暂无净资产快照</div>;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis dataKey="year" tick={{ fontSize: 12 }} />
        <YAxis tickFormatter={(v) => fmt(v / 10000, "万")} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v: number) => money(v)} />
        <Line type="monotone" dataKey="netAssets" name="净资产" stroke="#8b5cf6" strokeWidth={2} dot />
      </LineChart>
    </ResponsiveContainer>
  );
}

// 情景预测现金流图（仅情景：收入/支出/结余 三条曲线）
export function ScenarioCompare({ result }: { result: import("../shared").ScenarioResult }) {
  const data = result.scenario.map((s) => ({
    year: s.year,
    income: Math.round(s.income),
    expense: Math.round(s.expense),
    surplus: Math.round(s.surplus),
  }));
  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis dataKey="year" tick={{ fontSize: 12 }} />
        <YAxis tickFormatter={(v) => fmt(v / 10000, "万")} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v: number) => money(v)} />
        <Legend />
        <Line type="monotone" dataKey="income" name="收入" stroke="#10b981" strokeWidth={2} dot />
        <Line type="monotone" dataKey="expense" name="支出" stroke="#ef4444" strokeWidth={2} dot />
        <Line type="monotone" dataKey="surplus" name="结余" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// 情景预测月度现金流图（按月维度展示收入/支出/结余，可看月度平衡）
export function ScenarioMonthlyChart({ result }: { result: import("../shared").ScenarioResult }) {
  const data = result.monthly.scenario.map((m) => ({
    label: `${String(m.year).slice(2)}-${String(m.month).padStart(2, "0")}`,
    income: Math.round(m.income),
    expense: Math.round(m.expense),
    surplus: Math.round(m.surplus),
  }));
  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={5} />
        <YAxis tickFormatter={(v) => fmt(v / 10000, "万")} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v: number) => money(v)} />
        <Legend />
        <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="2 2" />
        <Line type="monotone" dataKey="income" name="月收入" stroke="#10b981" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="expense" name="月支出" stroke="#ef4444" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="surplus" name="月结余" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// 情景预测净资产变化图
// - 净资产面积曲线（左轴，紫色）：展示累计财富走势
// - 年度结余柱状图（右轴，绿正红负）：展示每年对净资产的贡献
// - 起始净资产参考线（灰色虚线）：高于此线即优于"什么都不做"的基线
// 核心叙事：头几年高薪累积净资产，后期小额赤字亦不影响整体财富，可能更优
export function ScenarioNetWorthChart({ result }: { result: import("../shared").ScenarioResult }) {
  const start = result.startNetWorth ?? 0;
  const data = result.scenario.map((s) => ({
    year: s.year,
    netWorth: Math.round(s.netWorth),
    surplus: Math.round(s.surplus),
  }));
  if (data.length === 0) return <div className="text-sm text-muted-foreground py-8 text-center">暂无净资产数据</div>;
  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis dataKey="year" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="netWorth" tickFormatter={(v) => fmt(v / 10000, "万")} tick={{ fontSize: 12 }} />
        <YAxis yAxisId="surplus" orientation="right" tickFormatter={(v) => fmt(v / 10000, "万")} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v: number) => money(v)} />
        <Legend />
        {/* 起始净资产参考线：高于此线 = 比基线更优 */}
        <ReferenceLine yAxisId="netWorth" y={start} stroke="#6b7280" strokeDasharray="5 5"
          label={{ value: "起始净资产", position: "insideTopRight", fontSize: 11, fill: "#6b7280" }} />
        {/* 结余 0 基线：清晰区分正负年份 */}
        <ReferenceLine yAxisId="surplus" y={0} stroke="#9ca3af" />
        {/* 年度结余柱：绿色为正（当年积累），红色为负（当年透支） */}
        <Bar yAxisId="surplus" dataKey="surplus" name="年度结余" radius={[2, 2, 0, 0]} maxBarSize={28}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.surplus >= 0 ? "#10b98199" : "#ef444499"} />
          ))}
        </Bar>
        {/* 净资产面积曲线：主叙事——财富累计轨迹 */}
        <Area yAxisId="netWorth" type="monotone" dataKey="netWorth" name="净资产"
          stroke="#8b5cf6" fill="#8b5cf622" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
