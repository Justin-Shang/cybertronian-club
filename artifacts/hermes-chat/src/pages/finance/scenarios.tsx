// Finance 情景预测：NL 描述 → 结构化确认 → 情景收支现金流曲线（可切换「考虑通胀」）
import { useState, useRef, useEffect } from "react";
import FinanceLayout from "./finance-layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Sparkles, FlaskConical, Trash2, Play, Eye, EyeOff, Info, Pencil, X, Plus, Check } from "lucide-react";
import { API, type Scenario, type ScenarioResult, type YearPoint, money, fmt, pct, apiFetch } from "./shared";
import { ScenarioCompare, ScenarioNetWorthChart } from "./components/Charts";

interface ParsedScenario {
  parsed: {
    name: string; description: string;
    income_adjustments: Array<Record<string, unknown>>;
    expense_adjustments: Array<Record<string, unknown>>;
    asset_adjustments: Array<Record<string, unknown>>;
  };
  confirm_token: string;
  confirm_message: string;
}

// 内联可编辑 div：非受控 contentEditable，挂载/值变更时同步，失焦时提交。
// 文本类字段（情景名、描述、备注）用 div 直接编辑，结构化字段仍用 Input/select。
function EditableDiv({ value, onCommit, className, placeholder }: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    // 仅在未聚焦时同步，避免编辑过程中光标跳动
    if (el && document.activeElement !== el && el.innerText !== value) {
      el.innerText = value;
    }
  }, [value]);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-ph={placeholder}
      className={className}
      onBlur={(e) => {
        const v = e.currentTarget.innerText.replace(/\u00a0/g, " ").trim();
        // 清空时移除残留 <br>，保证 :empty 占位符生效
        if (!v) e.currentTarget.innerHTML = "";
        onCommit(v);
      }}
    />
  );
}

// 表头带说明 tip：悬停 ⓘ 图标显示该列含义与计算方法
function HeaderTip({ label, tip, align = "left" }: { label: string; tip: string; align?: "left" | "right" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={"flex items-center gap-1 cursor-help " + (align === "right" ? "w-full justify-end" : "")}>
          <span>{label}</span>
          <Info className="w-3 h-3 opacity-40 hover:opacity-100 transition-opacity shrink-0" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-left whitespace-normal font-normal leading-relaxed">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

export default function FinanceScenarios() {
  const qc = useQueryClient();
  const [nlText, setNlText] = useState("");
  const [parsed, setParsed] = useState<ParsedScenario | null>(null);
  const [projectedYears, setProjectedYears] = useState(10);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  // 「考虑通胀」开关：默认关闭（按当前金额平推，不叠加通胀/教育增长）
  const [considerInflation, setConsiderInflation] = useState(false);
  // 记录最近一次推演的输入源，便于切换通胀开关时重跑
  const [lastSrc, setLastSrc] = useState<{
    income_adjustments?: unknown[]; expense_adjustments?: unknown[]; asset_adjustments?: unknown[]; baseline_year?: number;
  } | null>(null);
  const [lastYears, setLastYears] = useState(10);
  // 默认展开收入/支出明细，按类别拆分以便看清构成
  const [showBreakdown, setShowBreakdown] = useState(true);
  // 编辑已保存情景
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string; description: string; projectedYears: number;
    incomeAdjustments: Array<Record<string, unknown>>;
    expenseAdjustments: Array<Record<string, unknown>>;
    assetAdjustments: Array<Record<string, unknown>>;
  } | null>(null);

  // 编辑调整项 helper
  const updateAdj = (group: "income" | "expense" | "asset", idx: number, patch: Record<string, unknown>) => {
    setEditForm(prev => {
      if (!prev) return prev;
      const key = (group + "Adjustments") as "incomeAdjustments" | "expenseAdjustments" | "assetAdjustments";
      const arr = [...(prev[key] as Array<Record<string, unknown>>)];
      arr[idx] = { ...arr[idx], ...patch };
      return { ...prev, [key]: arr };
    });
  };
  const removeAdj = (group: "income" | "expense" | "asset", idx: number) => {
    setEditForm(prev => {
      if (!prev) return prev;
      const key = (group + "Adjustments") as "incomeAdjustments" | "expenseAdjustments" | "assetAdjustments";
      const arr = (prev[key] as Array<Record<string, unknown>>).filter((_, i) => i !== idx);
      return { ...prev, [key]: arr };
    });
  };
  const moveAdj = (fromGroup: "income" | "expense" | "asset", idx: number, toGroup: "income" | "expense" | "asset") => {
    setEditForm(prev => {
      if (!prev) return prev;
      const fromKey = (fromGroup + "Adjustments") as "incomeAdjustments" | "expenseAdjustments" | "assetAdjustments";
      const toKey = (toGroup + "Adjustments") as "incomeAdjustments" | "expenseAdjustments" | "assetAdjustments";
      const fromArr = [...(prev[fromKey] as Array<Record<string, unknown>>)];
      const [item] = fromArr.splice(idx, 1);
      const toArr = [...(prev[toKey] as Array<Record<string, unknown>>), item];
      return { ...prev, [fromKey]: fromArr, [toKey]: toArr };
    });
  };
  const addAdj = (group: "income" | "expense" | "asset") => {
    setEditForm(prev => {
      if (!prev) return prev;
      const key = (group + "Adjustments") as "incomeAdjustments" | "expenseAdjustments" | "assetAdjustments";
      const tmpl = group === "asset"
        ? { year_offset: 0, field: "cash", delta: 0, note: "" }
        : { year_offset: 0, type: "add", category: "", delta: 0, note: "" };
      return { ...prev, [key]: [...(prev[key] as Array<Record<string, unknown>>), tmpl] };
    });
  };
  const startEdit = (s: Scenario) => {
    setEditingId(s.id);
    setEditForm({
      name: s.name,
      description: s.description || "",
      projectedYears: s.projectedYears,
      incomeAdjustments: Array.isArray(s.incomeAdjustments) ? s.incomeAdjustments.map(a => ({ ...a })) : [],
      expenseAdjustments: Array.isArray(s.expenseAdjustments) ? s.expenseAdjustments.map(a => ({ ...a })) : [],
      assetAdjustments: Array.isArray(s.assetAdjustments) ? s.assetAdjustments.map(a => ({ ...a })) : [],
    });
  };
  const cancelEdit = () => { setEditingId(null); setEditForm(null); };

  const { data: scenarios } = useQuery<Scenario[]>({
    queryKey: ["finance-scenarios"],
    queryFn: async () => (await fetch(API + "/scenarios")).json(),
  });

  const parseMut = useMutation({
    mutationFn: (text: string) => apiFetch<ParsedScenario>("/scenarios/parse", { method: "POST", body: JSON.stringify({ text }) }),
    onSuccess: setParsed,
  });

  // 统一推演入口：用 scenario 对象（含 consider_inflation）调用，便于切换通胀开关重跑
  const runMut = useMutation({
    mutationFn: (p: {
      src: { income_adjustments?: unknown[]; expense_adjustments?: unknown[]; asset_adjustments?: unknown[]; baseline_year?: number };
      years: number;
      infl: boolean;
    }) => apiFetch<ScenarioResult>("/scenarios/run", {
      method: "POST",
      body: JSON.stringify({
        scenario: {
          income_adjustments: p.src.income_adjustments,
          expense_adjustments: p.src.expense_adjustments,
          asset_adjustments: p.src.asset_adjustments,
          baseline_year: p.src.baseline_year,
          projected_years: p.years,
          consider_inflation: p.infl,
        },
      }),
    }),
    onSuccess: setResult,
  });

  // 从解析结果推演
  const runParsed = () => {
    if (!parsed) return;
    const src = {
      income_adjustments: parsed.parsed.income_adjustments,
      expense_adjustments: parsed.parsed.expense_adjustments,
      asset_adjustments: parsed.parsed.asset_adjustments,
    };
    setLastSrc(src);
    setLastYears(projectedYears);
    runMut.mutate({ src, years: projectedYears, infl: considerInflation });
  };
  // 从已保存情景推演
  const rerunSaved = (s: Scenario) => {
    const src = {
      income_adjustments: s.incomeAdjustments as unknown[],
      expense_adjustments: s.expenseAdjustments as unknown[],
      asset_adjustments: s.assetAdjustments as unknown[],
      baseline_year: s.baselineYear,
    };
    setLastSrc(src);
    setLastYears(s.projectedYears);
    runMut.mutate({ src, years: s.projectedYears, infl: considerInflation });
  };
  // 切换通胀开关后重跑最近一次推演
  const rerunLast = (infl: boolean) => {
    if (!lastSrc) return;
    runMut.mutate({ src: lastSrc, years: lastYears, infl });
  };

  const saveMut = useMutation({
    mutationFn: (s: ParsedScenario["parsed"]) => apiFetch("/scenarios", { method: "POST", body: JSON.stringify({ name: s.name, description: s.description, income_adjustments: s.income_adjustments, expense_adjustments: s.expense_adjustments, asset_adjustments: s.asset_adjustments, projected_years: projectedYears }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-scenarios"] }),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => apiFetch("/scenarios/" + id, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-scenarios"] }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      apiFetch("/scenarios/" + id, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-scenarios"] });
      setEditingId(null);
      setEditForm(null);
    },
  });

  const saveEdit = (id: number) => {
    if (!editForm) return;
    updateMut.mutate({
      id,
      data: {
        name: editForm.name,
        description: editForm.description,
        income_adjustments: editForm.incomeAdjustments,
        expense_adjustments: editForm.expenseAdjustments,
        asset_adjustments: editForm.assetAdjustments,
        projected_years: editForm.projectedYears,
      },
    });
  };

  return (
    <FinanceLayout>
      <div className="p-6 space-y-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-primary" />
          情景预测
        </h1>
        <p className="text-sm text-muted-foreground">描述未来变化，基于当前财务基线推演 N 年收支现金流走势</p>

        {/* NL 输入 */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">情景描述</span>
          </div>
          <div className="flex gap-2">
            <Input value={nlText} onChange={(e) => setNlText(e.target.value)} placeholder="如：辞职创业，工资归零，前两年零收入，启动金50万" onKeyDown={(e) => { if (e.key === "Enter" && nlText) parseMut.mutate(nlText); }} />
            <Button onClick={() => nlText && parseMut.mutate(nlText)} disabled={parseMut.isPending}>解析</Button>
          </div>
          {parsed && (
            <div className="mt-3 p-3 rounded-md bg-muted/50 space-y-3">
              <div className="text-sm">
                <span className="font-medium">{parsed.parsed.name}</span>
                {parsed.parsed.description && <span className="text-muted-foreground ml-2">{parsed.parsed.description}</span>}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2 rounded bg-background">
                  <div className="text-muted-foreground">收入调整</div>
                  <div className="font-medium">{parsed.parsed.income_adjustments.length} 项</div>
                </div>
                <div className="p-2 rounded bg-background">
                  <div className="text-muted-foreground">支出调整</div>
                  <div className="font-medium">{parsed.parsed.expense_adjustments.length} 项</div>
                </div>
                <div className="p-2 rounded bg-background">
                  <div className="text-muted-foreground">资产调整</div>
                  <div className="font-medium">{parsed.parsed.asset_adjustments.length} 项</div>
                </div>
              </div>
              {(parsed.parsed.income_adjustments.length > 0 || parsed.parsed.expense_adjustments.length > 0 || parsed.parsed.asset_adjustments.length > 0) && (
                <div className="text-xs text-muted-foreground space-y-1 max-h-40 overflow-y-auto">
                  {[...parsed.parsed.income_adjustments.map((a, i) => ({ ...a, _type: "收入" })), ...parsed.parsed.expense_adjustments.map((a, i) => ({ ...a, _type: "支出" })), ...parsed.parsed.asset_adjustments.map((a, i) => ({ ...a, _type: "资产" }))].map((a, i) => (
                    <div key={i}>· [{a._type}] {String(a.note || a.type || "")} {a.delta !== undefined && `Δ${fmt(Number(a.delta))}`}{a.category && ` (${a.category})`}{a.field && ` (${a.field})`}</div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 items-center flex-wrap">
                <span className="text-xs text-muted-foreground">预测年限：</span>
                <Input type="number" value={projectedYears} onChange={(e) => setProjectedYears(Number(e.target.value) || 10)} className="h-7 w-20" min={1} max={30} />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none" title="开启后收入/支出按 2%/年、教育按 5%/年 增长；关闭则按当前金额平推">
                  <Switch checked={considerInflation} onCheckedChange={setConsiderInflation} className="scale-90" />
                  考虑通胀
                </label>
                <Button size="sm" onClick={() => runParsed()} disabled={runMut.isPending}>运行推演</Button>
                <Button size="sm" variant="outline" onClick={() => saveMut.mutate(parsed.parsed)} disabled={saveMut.isPending}>保存情景</Button>
                <Button size="sm" variant="ghost" onClick={() => setParsed(null)}>取消</Button>
              </div>
            </div>
          )}
        </Card>

        {/* 推演结果 */}
        {result && (() => {
          // 收入/支出类别列表（按字母序），用于明细列与分组表头
          const incomeCats = [...new Set(result.scenario.flatMap(s => Object.keys(s.incomeBreakdown || {})))].sort();
          const expenseCats = [...new Set(result.scenario.flatMap(s => Object.keys(s.expenseBreakdown || {})))].sort();
          return (
          <Card className="p-4 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-semibold">推演结果</h3>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none" title="开启后收入/支出按 2%/年、教育按 5%/年 增长；关闭则按当前金额平推。切换后自动重跑。">
                <Switch
                  checked={considerInflation}
                  onCheckedChange={(v) => { setConsiderInflation(v); rerunLast(v); }}
                  className="scale-90"
                />
                考虑通胀
              </label>
            </div>
            <ScenarioCompare result={result} />

            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <h4 className="text-sm font-medium">净资产变化</h4>
                <Info className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">
                紫色面积展示净资产累计走势，柱状图展示每年结余对净资产的贡献（绿正红负）。灰色虚线为起始净资产——高于此线即优于"什么都不做"。
                {result.scenario.length > 0 && result.scenario[result.scenario.length - 1].netWorth >= (result.startNetWorth ?? 0) ? (
                  <span className="text-emerald-600 font-medium"> 本情景末期净资产高于起点，属更优方案。</span>
                ) : (
                  <span className="text-amber-600 font-medium"> 本情景末期净资产低于起点，需关注。</span>
                )}
              </p>
              <ScenarioNetWorthChart result={result} />
            </div>

            {result.keyTurningPoints.filter(tp => tp.type !== "crossover").length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">关键拐点</h4>
                <div className="space-y-1">
                  {result.keyTurningPoints.filter(tp => tp.type !== "crossover").map((tp, i) => (
                    <div key={i} className="text-xs flex items-center gap-2">
                      <Badge variant="secondary">{tp.year}</Badge>
                      <span className="text-amber-600">{tp.label}</span>
                      <span className="text-muted-foreground">{tp.type.startsWith("debt") ? (tp.value * 100).toFixed(1) + "%" : fmt(tp.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">逐年数据</h4>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowBreakdown(v => !v)}>
                  {showBreakdown ? <EyeOff className="w-3.5 h-3.5 mr-1" /> : <Eye className="w-3.5 h-3.5 mr-1" />}
                  {showBreakdown ? "隐藏明细" : "显示明细"}
                </Button>
              </div>

              {/* 读表说明 */}
              <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2.5 mb-2 leading-relaxed">
                <span className="font-medium text-foreground">读表说明：</span>
                每行代表一个预测年份，自基线年起逐年推演。
                <span className="text-blue-600 font-medium"> 情景</span> ＝ 在当前收支基础上叠加你描述的调整项；
                <span className="font-medium text-foreground">「考虑通胀」</span>开启时收入/支出按 2%/年、教育按 5%/年 增长，关闭则保持当前金额不变；
                <span className="text-emerald-600 font-medium"> 投资收益</span>按上年净资产 × 投资占比 × 4% 估算。悬停表头
                <Info className="inline w-3 h-3 mx-0.5 -mt-0.5" /> 查看计算方法。
              </div>

              <TooltipProvider delayDuration={200}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead className="bg-muted/50">
                      {showBreakdown ? (
                        <>
                          <tr className="border-b border-border/50">
                            <th rowSpan={2} className="text-left p-2 sticky left-0 bg-muted/50 align-bottom">
                              <HeaderTip label="年份" align="left" tip="每一行代表一个预测年份，自基线年（当前年或推演起始年）起逐年向前推演 N 年。" />
                            </th>
                            <th colSpan={incomeCats.length + 1} className="text-center p-1 text-emerald-700 dark:text-emerald-400 font-medium">收入明细</th>
                            <th colSpan={expenseCats.length + 1} className="text-center p-1 text-red-700 dark:text-red-400 font-medium">支出明细</th>
                            <th rowSpan={2} className="text-center p-1 text-muted-foreground font-medium">结余</th>
                          </tr>
                          <tr>
                            {incomeCats.map(c => (
                              <th key={"ic"+c} className="text-right p-2 text-emerald-700 dark:text-emerald-400">
                                <HeaderTip label={c} align="right" tip={`「${c}」类年度收入 ＝ 该类基线月均 × 12 × 增长系数（考虑通胀时 1.02^年数，教育 1.05^年数），并叠加该类别的调整项（新增/增减/移除）。`} />
                              </th>
                            ))}
                            <th className="text-right p-2 text-emerald-600">
                              <HeaderTip label="收入合计" align="right" tip="年度总收入 ＝ 各收入类别之和（含投资收益）。已叠加收入调整项；考虑通胀时按系数逐年增长。" />
                            </th>
                            {expenseCats.map(c => (
                              <th key={"ec"+c} className="text-right p-2 text-red-700 dark:text-red-400">
                                <HeaderTip label={c} align="right" tip={`「${c}」类年度支出 ＝ 该类基线月均 × 12 × 增长系数（教育类 1.05^年数，其余考虑通胀时 1.02^年数），并叠加调整项。`} />
                              </th>
                            ))}
                            <th className="text-right p-2 text-red-600">
                              <HeaderTip label="支出合计" align="right" tip="年度总支出 ＝ 各支出类别之和。已叠加支出调整项；教育类按 5%/年 增长，其余考虑通胀时按 2%/年 增长。" />
                            </th>
                          </tr>
                        </>
                      ) : (
                        <tr>
                          <th className="text-left p-2 sticky left-0 bg-muted/50">
                            <HeaderTip label="年份" align="left" tip="每一行代表一个预测年份，自基线年起逐年向前推演 N 年。" />
                          </th>
                          <th className="text-right p-2 text-emerald-600">
                            <HeaderTip label="收入合计" align="right" tip="年度总收入 ＝ 各收入类别之和（含投资收益）。已叠加收入调整项；考虑通胀时按系数逐年增长。" />
                          </th>
                          <th className="text-right p-2 text-red-600">
                            <HeaderTip label="支出合计" align="right" tip="年度总支出 ＝ 各支出类别之和。已叠加支出调整项；教育类按 5%/年 增长，其余考虑通胀时按 2%/年 增长。" />
                          </th>
                          <th className="text-right p-2">
                            <HeaderTip label="结余" align="right" tip="结余 ＝ 收入合计 − 支出合计。绿色为正（当年现金流转正），红色为负（入不敷出）。" />
                          </th>
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {result.scenario.map((s: YearPoint) => {
                        return (
                          <tr key={s.year} className="border-t border-border/50">
                            <td className="p-2 sticky left-0 bg-background">{s.year}</td>
                            {showBreakdown && incomeCats.map(c => (
                              <td key={"ic"+c} className="p-2 text-right text-muted-foreground">{fmt((s.incomeBreakdown?.[c] || 0) / 10000, "万")}</td>
                            ))}
                            <td className="p-2 text-right font-medium text-emerald-600">{fmt(s.income / 10000, "万")}</td>
                            {showBreakdown && expenseCats.map(c => (
                              <td key={"ec"+c} className="p-2 text-right text-muted-foreground">{fmt((s.expenseBreakdown?.[c] || 0) / 10000, "万")}</td>
                            ))}
                            <td className="p-2 text-right font-medium text-red-600">{fmt(s.expense / 10000, "万")}</td>
                            <td className={"p-2 text-right font-medium " + (s.surplus >= 0 ? "text-emerald-600" : "text-red-600")}>{fmt(s.surplus / 10000, "万")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </TooltipProvider>
            </div>

            {/* 资产变化表 */}
            <div>
              <h4 className="text-sm font-medium mb-2">资产变化</h4>
              <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2.5 mb-2 leading-relaxed">
                <span className="font-medium text-foreground">读表说明：</span>
                <span className="text-purple-600 font-medium"> 净资产</span> ＝ 上年净资产 ＋ 当年结余 ＋ 一次性资产调整；
                <span className="text-blue-600 font-medium"> 总资产</span> ＝ 净资产 ＋ 总负债；
                <span className="text-amber-600 font-medium"> 年度增减</span> ＝ 当年净资产 − 上年净资产，绿色为增、红色为减。悬停表头
                <Info className="inline w-3 h-3 mx-0.5 -mt-0.5" /> 查看计算方法。
              </div>
              <TooltipProvider delayDuration={200}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 sticky left-0 bg-muted/50">
                          <HeaderTip label="年份" align="left" tip="每一行代表一个预测年份，自基线年起逐年推演。" />
                        </th>
                        <th className="text-right p-2 text-blue-600">
                          <HeaderTip label="总资产" align="right" tip="总资产 ＝ 净资产 ＋ 总负债。体现家庭全部资产规模。" />
                        </th>
                        <th className="text-right p-2 text-orange-600">
                          <HeaderTip label="总负债" align="right" tip="当前债务余额（如房贷剩余本金等），推演期间保持不变（暂不模拟还贷递减）。" />
                        </th>
                        <th className="text-right p-2 text-purple-600">
                          <HeaderTip label="净资产" align="right" tip="净资产 ＝ 上年净资产 ＋ 当年结余 ＋ 一次性资产调整。体现财富累计走势，对应上方净资产图的紫色曲线。" />
                        </th>
                        <th className="text-right p-2">
                          <HeaderTip label="年度增减" align="right" tip="当年净资产 − 上年净资产。首年对比起始净资产（当前快照）。绿色为增、红色为减，对应净资产图的绿/红柱。" />
                        </th>
                        <th className="text-right p-2 text-muted-foreground">
                          <HeaderTip label="资产负债率" align="right" tip="资产负债率 ＝ 总负债 ÷ 总资产。越高说明杠杆越大，一般建议控制在 50% 以下。" />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.scenario.map((s: YearPoint, i: number) => {
                        const prevNet = i === 0 ? (result.startNetWorth ?? 0) : result.scenario[i - 1].netWorth;
                        const delta = s.netWorth - prevNet;
                        const dr = s.totalAssets > 0 ? s.totalDebt / s.totalAssets : 1;
                        return (
                          <tr key={s.year} className="border-t border-border/50">
                            <td className="p-2 sticky left-0 bg-background">{s.year}</td>
                            <td className="p-2 text-right font-medium text-blue-600">{fmt(s.totalAssets / 10000, "万")}</td>
                            <td className="p-2 text-right text-orange-600">{fmt(s.totalDebt / 10000, "万")}</td>
                            <td className="p-2 text-right font-medium text-purple-600">{fmt(s.netWorth / 10000, "万")}</td>
                            <td className={"p-2 text-right font-medium " + (delta >= 0 ? "text-emerald-600" : "text-red-600")}>
                              {delta >= 0 ? "+" : ""}{fmt(delta / 10000, "万")}
                            </td>
                            <td className={"p-2 text-right " + (dr > 0.5 ? "text-red-600 font-medium" : "text-muted-foreground")}>{pct(dr)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </TooltipProvider>
            </div>
          </Card>
          );
        })()}

        {/* 已保存情景（可内联编辑：点击编辑后整行变为可编辑 div） */}
        <Card className="p-4">
          <h3 className="font-semibold mb-3">已保存情景</h3>
          {(scenarios || []).length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">暂无保存的情景</div>
          ) : (
            <div className="space-y-1">
              {(scenarios || []).map((s) => {
                const isEditing = editingId === s.id && editForm;
                if (isEditing) {
                  const allAdj = [
                    ...editForm!.incomeAdjustments.map((a, i) => ({ ...a, _group: "income" as const, _idx: i })),
                    ...editForm!.expenseAdjustments.map((a, i) => ({ ...a, _group: "expense" as const, _idx: i })),
                    ...editForm!.assetAdjustments.map((a, i) => ({ ...a, _group: "asset" as const, _idx: i })),
                  ];
                  return (
                    <div key={s.id} className="p-3 rounded-md bg-muted/30 space-y-2.5">
                      {/* 名称 + 预测年限 */}
                      <div className="flex gap-2 items-center">
                        <EditableDiv
                          value={editForm!.name}
                          onCommit={(v) => setEditForm(prev => prev ? { ...prev, name: v } : prev)}
                          placeholder="情景名称"
                          className="flex-1 px-2 py-1 rounded bg-background text-sm font-medium min-h-[28px]"
                        />
                        <span className="text-xs text-muted-foreground shrink-0">预测年限</span>
                        <Input type="number" value={editForm!.projectedYears} onChange={e => setEditForm(prev => prev ? { ...prev, projectedYears: Number(e.target.value) || 10 } : prev)} className="h-7 w-16" min={1} max={30} />
                      </div>
                      {/* 描述 */}
                      <EditableDiv
                        value={editForm!.description}
                        onCommit={(v) => setEditForm(prev => prev ? { ...prev, description: v } : prev)}
                        placeholder="描述（可选）"
                        className="px-2 py-1 rounded bg-background text-xs text-muted-foreground min-h-[24px]"
                      />
                      {/* 调整项 */}
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-muted-foreground">调整项（offset = 相对基线年偏移，0 = 基线年当年）</div>
                        {allAdj.length === 0 && (
                          <div className="text-xs text-muted-foreground/60 px-1">无调整项</div>
                        )}
                        {allAdj.map((a, i) => (
                          <div key={i} className="flex gap-1 items-center text-xs flex-wrap">
                            <select
                              value={a._group}
                              onChange={e => moveAdj(a._group, a._idx, e.target.value as "income" | "expense" | "asset")}
                              className="h-7 rounded border border-input bg-background px-1 shrink-0"
                              title="分组"
                            >
                              <option value="income">收入</option>
                              <option value="expense">支出</option>
                              <option value="asset">资产</option>
                            </select>
                            <Input
                              type="number"
                              value={Number(a.year_offset ?? 0)}
                              onChange={e => updateAdj(a._group, a._idx, { year_offset: Number(e.target.value) || 0 })}
                              className="h-7 w-12"
                              title="year_offset（相对基线年偏移）"
                            />
                            {a._group === "asset" ? (
                              <select
                                value={String(a.field ?? "cash")}
                                onChange={e => updateAdj(a._group, a._idx, { field: e.target.value })}
                                className="h-7 rounded border border-input bg-background px-1 shrink-0"
                                title="资产字段"
                              >
                                <option value="cash">现金</option>
                                <option value="investment">投资</option>
                                <option value="real_estate">房产</option>
                                <option value="other_assets">其他</option>
                              </select>
                            ) : (
                              <>
                                <select
                                  value={String(a.type ?? "add")}
                                  onChange={e => updateAdj(a._group, a._idx, { type: e.target.value })}
                                  className="h-7 rounded border border-input bg-background px-1 shrink-0"
                                  title="类型"
                                >
                                  <option value="remove">移除</option>
                                  <option value="add">新增</option>
                                  <option value="modify">增减</option>
                                </select>
                                <Input
                                  value={String(a.category ?? "")}
                                  onChange={e => updateAdj(a._group, a._idx, { category: e.target.value })}
                                  className="h-7 w-20"
                                  placeholder="类别"
                                />
                              </>
                            )}
                            <Input
                              type="number"
                              value={Number(a.delta ?? 0)}
                              onChange={e => updateAdj(a._group, a._idx, { delta: Number(e.target.value) || 0 })}
                              className="h-7 w-24"
                              title="金额（元，可负）"
                            />
                            <Input
                              value={String(a.note ?? "")}
                              onChange={e => updateAdj(a._group, a._idx, { note: e.target.value })}
                              className="h-7 flex-1 min-w-[80px]"
                              placeholder="备注"
                            />
                            <button
                              onClick={() => removeAdj(a._group, a._idx)}
                              className="w-7 h-7 rounded flex items-center justify-center text-red-500 hover:bg-red-500/10 shrink-0"
                              title="删除此调整项"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-3">
                          <button onClick={() => addAdj("income")} className="text-xs text-primary hover:underline flex items-center gap-1">
                            <Plus className="w-3 h-3" /> 收入项
                          </button>
                          <button onClick={() => addAdj("expense")} className="text-xs text-primary hover:underline flex items-center gap-1">
                            <Plus className="w-3 h-3" /> 支出项
                          </button>
                          <button onClick={() => addAdj("asset")} className="text-xs text-primary hover:underline flex items-center gap-1">
                            <Plus className="w-3 h-3" /> 资产项
                          </button>
                        </div>
                      </div>
                      {/* 保存 / 取消 */}
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" onClick={() => saveEdit(s.id)} disabled={updateMut.isPending}>
                          <Check className="w-3.5 h-3.5 mr-1" /> 保存
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit}>取消</Button>
                        {updateMut.isError && <span className="text-xs text-red-500 self-center">保存失败</span>}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={s.id} className="flex items-center justify-between text-sm py-2 border-b border-border/50 last:border-0">
                    <div className="min-w-0">
                      <span className="font-medium">{s.name}</span>
                      {s.description && <span className="text-muted-foreground ml-2 text-xs">{s.description}</span>}
                      <div className="text-xs text-muted-foreground mt-0.5">
                        收入调整 {Array.isArray(s.incomeAdjustments) ? s.incomeAdjustments.length : 0} 项 · 支出调整 {Array.isArray(s.expenseAdjustments) ? s.expenseAdjustments.length : 0} 项 · 资产调整 {Array.isArray(s.assetAdjustments) ? s.assetAdjustments.length : 0} 项 · {s.projectedYears} 年
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="ghost" title="重新推演" onClick={() => rerunSaved(s)} disabled={runMut.isPending}>
                        <Play className="w-3.5 h-3.5 text-blue-500" />
                      </Button>
                      <Button size="sm" variant="ghost" title="编辑" onClick={() => startEdit(s)}>
                        <Pencil className="w-3.5 h-3.5 text-amber-500" />
                      </Button>
                      <Button size="sm" variant="ghost" title="删除" onClick={() => delMut.mutate(s.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </FinanceLayout>
  );
}
