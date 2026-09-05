// Finance 导入向导 v1.3：多 sheet + 形态识别 + 逐表确认入库
import { useState } from "react";
import FinanceLayout from "./finance-layout";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, Wand2, CheckCircle2, AlertCircle, Layers, Database } from "lucide-react";
import { API, apiFetch } from "./shared";

// ──────────────── 类型定义 ────────────────

type SheetShape = "standard" | "pivot" | "wide" | "simple";

interface SheetData {
  name: string;
  rows: Array<Record<string, string>>;
  headers: string[];
  inferredMapping: Record<string, string>;
  rowCount: number;
  shape: SheetShape;
  suggestedTable: string;
  notes: string[];
}

interface ParsedUpload {
  sheets: SheetData[];
}

interface PreviewRow {
  fields: Record<string, unknown>;
  valid?: boolean;
  errors?: string[];
  confidence?: number;
  issues?: string[];
  row_index?: number;
}

const TABLES = ["income", "expense", "net_worth", "education_fund", "debt"];
const TABLE_LABELS: Record<string, string> = {
  income: "收入明细", expense: "支出明细", net_worth: "资产负债快照",
  education_fund: "教育基金", debt: "债务明细",
};

const SHAPE_LABELS: Record<SheetShape, { label: string; color: string }> = {
  standard: { label: "标准明细", color: "bg-slate-500/15 text-slate-600" },
  pivot: { label: "透视表", color: "bg-purple-500/15 text-purple-600" },
  wide: { label: "宽表", color: "bg-blue-500/15 text-blue-600" },
  simple: { label: "简表", color: "bg-emerald-500/15 text-emerald-600" },
};

// 形态→默认模式
function shapeToMode(shape: SheetShape): "structured" | "smart" | "pivot" {
  if (shape === "pivot") return "pivot";
  if (shape === "wide") return "structured"; // 宽表已在后端逆透视，按结构化走
  return "structured";
}

// ──────────────── 主组件 ────────────────

export default function FinanceImport() {
  const [uploaded, setUploaded] = useState<ParsedUpload | null>(null);
  const [fileName, setFileName] = useState("");
  const [results, setResults] = useState<Array<{ sheetName: string; inserted: number; table: string }>>([]);
  // 预览结果缓存：sheetName → PreviewRow[]
  const [previewCache, setPreviewCache] = useState<Record<string, PreviewRow[]>>({});

  const { data: schemas } = useQuery({
    queryKey: ["finance-tables"],
    queryFn: async () => (await fetch(API + "/tables")).json() as Promise<Array<{ table: string; label: string; columns: Array<{ field: string; label: string; type: string; required?: boolean }> }>>,
  });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(API + "/import/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(e.error || "上传失败");
      }
      return res.json() as Promise<ParsedUpload>;
    },
    onSuccess: (data) => {
      setUploaded(data);
      setResults([]);
      setPreviewCache({});
    },
  });

  const previewMut = useMutation({
    mutationFn: async (params: { table: string; mode: "structured" | "smart" | "pivot"; rows: Array<Record<string, string>>; mapping: Record<string, string> }) =>
      apiFetch<{ rows: PreviewRow[] }>("/import/preview", {
        method: "POST",
        body: JSON.stringify(params),
      }),
  });

  const commitMut = useMutation({
    mutationFn: async (params: { table: string; rows: Array<Record<string, unknown>> }) =>
      apiFetch<{ inserted: number; table: string }>("/import/commit", {
        method: "POST",
        body: JSON.stringify(params),
      }),
  });

  const handlePreview = (
    table: string,
    mode: "structured" | "smart" | "pivot",
    rows: Array<Record<string, string>>,
    mapping: Record<string, string>,
    sheetName: string,
  ) => {
    previewMut.mutate({ table, mode, rows, mapping }, {
      onSuccess: (data) => {
        setPreviewCache((prev) => ({ ...prev, [sheetName]: data.rows }));
      },
    });
  };

  const handleCommit = (table: string, rows: PreviewRow[], sheetName: string) => {
    commitMut.mutate(
      { table, rows: rows.map((r) => r.fields) },
      {
        onSuccess: (data) => {
          setResults((prev) => [...prev, { sheetName, inserted: data.inserted, table }]);
          setPreviewCache((prev) => { const next = { ...prev }; delete next[sheetName]; return next; });
        },
      },
    );
  };

  return (
    <FinanceLayout>
      <div className="p-6 space-y-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Upload className="w-5 h-5 text-primary" />
          石墨表格导入
        </h1>
        <p className="text-sm text-muted-foreground">
          上传 CSV/Excel → 自动识别多 sheet + 形态（标准/透视/宽表/简表）→ 逐表确认入库
        </p>

        {/* 步骤 1: 上传 */}
        <Card className="p-4 space-y-3">
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { setFileName(f.name); uploadMut.mutate(f); }
              }}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <div className="text-sm font-medium">{fileName || "点击选择 CSV/Excel 文件"}</div>
              <div className="text-xs text-muted-foreground mt-1">≤10MB，支持 .csv / .xlsx / .xls，自动识别多 sheet</div>
            </label>
          </div>
          {uploadMut.isPending && <div className="text-sm text-muted-foreground">解析中...</div>}
          {uploadMut.isError && <div className="text-sm text-red-600">上传失败：{String(uploadMut.error?.message || "")}</div>}
          {uploaded && (
            <div className="text-sm">
              ✓ 解析到 <span className="font-medium">{uploaded.sheets.length}</span> 个 sheet
              {uploaded.sheets.length > 0 && (
                <span className="text-muted-foreground ml-2">
                  （{uploaded.sheets.map((s) => `${s.name}(${s.rowCount}行)`).join("、")}）
                </span>
              )}
            </div>
          )}
        </Card>

        {/* 步骤 2: 逐 sheet 处理 */}
        {uploaded && uploaded.sheets.length > 0 && (
          <div className="space-y-3">
            <div className="text-sm font-medium flex items-center gap-2">
              <Database className="w-4 h-4" />
              逐 sheet 选择目标表 + 预览 + 入库
            </div>
            {uploaded.sheets.map((sheet) => (
              <SheetCardWithPreview
                key={sheet.name}
                sheet={sheet}
                schemas={schemas}
                previewData={previewCache[sheet.name] || null}
                previewPending={previewMut.isPending}
                commitPending={commitMut.isPending}
                onPreview={(table, mode, rows, mapping) => handlePreview(table, mode, rows, mapping, sheet.name)}
                onCommit={(table, rows) => handleCommit(table, rows, sheet.name)}
              />
            ))}
          </div>
        )}

        {/* 入库结果 */}
        {results.length > 0 && (
          <Card className="p-4 space-y-2">
            <div className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              入库结果
            </div>
            {results.map((r, i) => (
              <div key={i} className="text-sm flex items-center justify-between">
                <span>{r.sheetName} → {TABLE_LABELS[r.table] || r.table}</span>
                <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600">+{r.inserted} 行</Badge>
              </div>
            ))}
          </Card>
        )}

        {uploaded && uploaded.sheets.length === 0 && (
          <Card className="p-4 text-center text-muted-foreground text-sm">
            文件无有效数据，请检查文件内容
          </Card>
        )}
      </div>
    </FinanceLayout>
  );
}

// ──────────────── SheetCard 包装（注入预览数据）────────────────

function SheetCardWithPreview({
  sheet,
  schemas,
  previewData,
  previewPending,
  commitPending,
  onPreview,
  onCommit,
}: {
  sheet: SheetData;
  schemas: Array<{ table: string; label: string; columns: Array<{ field: string; label: string; type: string; required?: boolean }> }> | undefined;
  previewData: PreviewRow[] | null;
  previewPending: boolean;
  commitPending: boolean;
  onPreview: (table: string, mode: "structured" | "smart" | "pivot", rows: Array<Record<string, string>>, mapping: Record<string, string>) => void;
  onCommit: (table: string, rows: PreviewRow[]) => void;
}) {
  const [targetTable, setTargetTable] = useState(sheet.suggestedTable);
  const [mode, setMode] = useState<"structured" | "smart" | "pivot">(shapeToMode(sheet.shape));
  const [mapping, setMapping] = useState<Record<string, string>>(sheet.inferredMapping);

  const currentSchema = schemas?.find((s) => s.table === targetTable);
  const shapeInfo = SHAPE_LABELS[sheet.shape];
  const validPreview = previewData
    ? (mode === "structured" ? previewData.filter((r) => r.valid) : previewData.filter((r) => (r.confidence ?? 0) >= 0.7))
    : [];

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <span className="font-medium">{sheet.name}</span>
          <Badge variant="secondary" className={shapeInfo.color}>{shapeInfo.label}</Badge>
          <span className="text-xs text-muted-foreground">{sheet.rowCount} 行</span>
        </div>
        {previewData && (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="w-3 h-3 mr-1" />已预览 {previewData.length} 行（有效 {validPreview.length}）
          </Badge>
        )}
      </div>

      {sheet.notes.length > 0 && (
        <div className="text-xs text-amber-600 bg-amber-500/5 rounded p-2">
          {sheet.notes.map((n, i) => <div key={i}>• {n}</div>)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">目标表</label>
          <select
            value={targetTable}
            onChange={(e) => setTargetTable(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            {TABLES.map((t) => <option key={t} value={t}>{TABLE_LABELS[t]}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">模式</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "structured" | "smart" | "pivot")}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="structured">结构化（列映射）</option>
            <option value="smart">智能提取（LLM）</option>
            <option value="pivot">透视表提取（LLM）</option>
          </select>
        </div>

        <Button size="sm" variant="outline" onClick={() => onPreview(targetTable, mode, sheet.rows, mapping)} disabled={previewPending}>
          {previewPending ? <Wand2 className="w-3.5 h-3.5 mr-1 animate-pulse" /> : <FileText className="w-3.5 h-3.5 mr-1" />}
          {previewPending ? "预览中..." : "生成预览"}
        </Button>
        {previewData && validPreview.length > 0 && (
          <Button size="sm" onClick={() => onCommit(targetTable, validPreview)} disabled={commitPending}>
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            {commitPending ? "入库中..." : `确认入库 (${validPreview.length}/${previewData.length})`}
          </Button>
        )}
      </div>

      {/* 列映射（仅 structured 模式） */}
      {mode === "structured" && currentSchema && sheet.rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-muted/30 p-2 rounded">
          {currentSchema.columns.filter((c) => c.field !== "id" && c.field !== "created_at").map((col) => (
            <div key={col.field} className="flex items-center gap-1">
              <label className="text-xs text-muted-foreground w-16 shrink-0">{col.label}{col.required && <span className="text-red-500">*</span>}</label>
              <select
                value={mapping[col.field] || ""}
                onChange={(e) => setMapping({ ...mapping, [col.field]: e.target.value })}
                className="h-7 flex-1 rounded border border-input bg-background px-1 text-xs"
              >
                <option value="">（不映射）</option>
                {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* 预览表格 */}
      {previewData && (
        <div className="overflow-x-auto max-h-80 border rounded">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left p-2">#</th>
                {currentSchema && currentSchema.columns.filter((c) => c.field !== "id" && c.field !== "created_at").map((c) => (
                  <th key={c.field} className="text-left p-2">{c.label}</th>
                ))}
                {(mode === "smart" || mode === "pivot") && <th className="text-left p-2">置信度</th>}
                <th className="text-left p-2">状态</th>
              </tr>
            </thead>
            <tbody>
              {previewData.map((r, i) => {
                const valid = mode === "structured" ? (r.valid ?? true) : (r.confidence ?? 0) >= 0.7;
                return (
                  <tr key={i} className={"border-t border-border/50 " + (!valid ? "bg-red-50 dark:bg-red-950/20" : "")}>
                    <td className="p-2 text-muted-foreground">{i + 1}</td>
                    {currentSchema && currentSchema.columns.filter((c) => c.field !== "id" && c.field !== "created_at").map((c) => (
                      <td key={c.field} className="p-2">{String(r.fields?.[c.field] ?? "")}</td>
                    ))}
                    {(mode === "smart" || mode === "pivot") && (
                      <td className="p-2">
                        <Badge variant="secondary" className={(r.confidence ?? 0) >= 0.7 ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"}>
                          {((r.confidence ?? 0) * 100).toFixed(0)}%
                        </Badge>
                      </td>
                    )}
                    <td className="p-2">
                      {valid ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-500" />}
                      {r.errors && r.errors.length > 0 && <span className="text-xs text-amber-600 ml-1">{r.errors.join("; ")}</span>}
                      {r.issues && r.issues.length > 0 && <span className="text-xs text-amber-600 ml-1">{r.issues.join("; ")}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
