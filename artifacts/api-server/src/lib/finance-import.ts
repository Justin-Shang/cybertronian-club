/**
 * Finance 石墨导入解析 v1.3 — 多 sheet + 形态识别 + 规范化。
 *
 * 升级点：
 *  1. 多 sheet 解析（之前只读 SheetNames[0]）
 *  2. 表格形态识别：standard / pivot / wide / simple
 *  3. Excel 序列号→日期转换
 *  4. 宽表逆透视（unpivot）
 *  5. 万/w/k → 元单位换算
 *  6. 总计行过滤
 *
 * 透视表（pivot）的 LLM 提取由 routes 层调 extractRowsLLM 完成。
 */
import xlsx from "xlsx";
import { parse as csvParse } from "csv-parse/sync";

// ──────────────── 类型定义 ────────────────

export type SheetShape = "standard" | "pivot" | "wide" | "simple";

export interface SheetData {
  name: string;
  rows: Array<Record<string, string>>;
  headers: string[];
  inferredMapping: Record<string, string>;
  rowCount: number;
  shape: SheetShape;
  suggestedTable: string;
  /** 形态识别/规范化过程中的提示信息 */
  notes: string[];
}

export interface ParsedUpload {
  sheets: SheetData[];
}

export interface StructuredRow {
  fields: Record<string, unknown>;
  valid: boolean;
  errors: string[];
}

// ──────────────── 列名别名（保留 v1.2）────────────────

const FIELD_ALIASES: Record<string, string[]> = {
  tx_date: ["日期", "到账日期", "支出日期", "时间", "date", "tx_date", "发生日期"],
  amount: ["金额", "数额", "金额(元)", "amount", "金额（元）"],
  category: ["分类", "类别", "category", "类型", "项目"],
  source: ["来源", "来源方", "source", "对方"],
  payee: ["收款方", "对方账户", "payee", "商家"],
  note: ["备注", "说明", "note", "描述", "摘要"],
  direction: ["方向", "direction", "收支"],
  child_name: ["孩子", "姓名", "child_name", "宝宝", "名称"],
  lender: ["债权人", "借出方", "lender", "对方", "出借人"],
  interest_rate: ["利率", "年利率", "interest_rate"],
  due_date: ["到期日", "还款日", "due_date"],
  is_major: ["大额", "is_major"],
  snapshot_date: ["快照日期", "日期", "snapshot_date"],
  total_assets: ["总资产", "total_assets"],
  total_liabilities: ["总负债", "total_liabilities"],
  cash: ["现金", "活期", "cash"],
  investment: ["投资", "理财", "investment"],
  real_estate: ["房产", "real_estate"],
  other_assets: ["其他资产", "other_assets"],
};

export function inferMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (let i = 0; i < headers.length; i++) {
      const h = lowerHeaders[i];
      const orig = headers[i];
      if (aliases.some((a) => h === a.toLowerCase() || h.includes(a.toLowerCase()) || a.toLowerCase().includes(h))) {
        if (!mapping[field]) mapping[field] = orig;
      }
    }
  }
  return mapping;
}

// ──────────────── 工具函数 ────────────────

/** Excel 序列号 → YYYY-MM-DD（1900 epoch，规避 1900-02-29 bug） */
export function excelSerialToDate(serial: number): string {
  // 25569 = 1970-01-01 的 Excel 序列号
  const unixMs = Math.round((serial - 25569) * 86400 * 1000);
  if (unixMs < 0 || !Number.isFinite(unixMs)) return "";
  const d = new Date(unixMs);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** 检测字符串是否为 Excel 日期序列号（纯数字，范围 1-60000） */
function isExcelSerial(v: string): boolean {
  if (!v) return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 1000 && n < 60000 && /^\d+(\.\d+)?$/.test(v.trim());
}

/** 万/w/k → 元单位换算。"8万"=80000, "84w"=840000, "5k"=5000, "300"=300 */
export function normalizeAmount(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (!s) return 0;
  // 匹配 "数字+单位" 模式，单位为 万/w/W/k/K
  const m = s.match(/^([-+]?\d+(?:\.\d+)?)\s*(万|w|W|k|K)?$/);
  if (m) {
    const n = parseFloat(m[1]);
    const unit = m[2];
    if (unit === "万" || unit === "w" || unit === "W") return Math.round(n * 10000);
    if (unit === "k" || unit === "K") return Math.round(n * 1000);
    return n;
  }
  // 含"约"等修饰词
  const m2 = s.match(/约?\s*([-+]?\d+(?:\.\d+)?)\s*(万|w|W|k|K)?/);
  if (m2) {
    const n = parseFloat(m2[1]);
    const unit = m2[2];
    if (unit === "万" || unit === "w" || unit === "W") return Math.round(n * 10000);
    if (unit === "k" || unit === "K") return Math.round(n * 1000);
    return n;
  }
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** 检测行是否为总计行 */
function isTotalRow(row: Record<string, string>): boolean {
  const firstVal = Object.values(row)[0];
  if (!firstVal) return false;
  return /总计|合计|汇总|Total|Sum|小计/i.test(String(firstVal));
}

/** 过滤总计行 */
export function filterTotalRows(rows: Array<Record<string, string>>): Array<Record<string, string>> {
  return rows.filter((r) => !isTotalRow(r));
}

// ──────────────── 形态识别引擎 ────────────────

const DATE_HEADER_PATTERNS = [
  /^\d{4}[-/]\d{1,2}$/,        // 2024-01, 2024/1
  /^\d{4}年\d{1,2}月$/,         // 2024年1月
  /^\d{1,2}月$/,                 // 1月, 12月
  /^\d{4}$/,                     // 2024（年份）
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i,
  /^Q[1-4]$/,                    // Q1-Q4
];

/** 检测列头是否为日期/时间维度 */
function isDateHeader(h: string): boolean {
  const s = String(h).trim();
  return DATE_HEADER_PATTERNS.some((p) => p.test(s));
}

/** 检测单元格是否为"文本+数字混杂"（如 "8月工资80000"） */
function isMixedCell(v: string): boolean {
  if (!v) return false;
  const s = String(v).trim();
  // 同时含数字和中文/字母
  const hasDigit = /\d/.test(s);
  const hasChineseOrAlpha = /[\u4e00-\u9fa5]|[a-zA-Z]/.test(s);
  // 但不是纯数字或纯日期
  const isPureNumber = /^[-+]?\d+(?:\.\d+)?\s*(万|w|k)?$/.test(s);
  return hasDigit && hasChineseOrAlpha && !isPureNumber;
}

/**
 * 表格形态识别
 * - wide: 列头含日期/月份模式且占比 > 40% → 宽表（每列一个时间点）
 * - pivot: 单元格文本+数字混杂率高 → 透视表/非结构化
 * - simple: 列数 ≤ 5 且无复杂混杂单元格 → 简表
 * - standard: 其他（默认，常规明细）
 */
export function detectShape(headers: string[], rows: Array<Record<string, string>>): SheetShape {
  if (headers.length === 0 || rows.length === 0) return "standard";

  // 宽表：日期列头占比 > 40%（放宽阈值，教育基金可能只有 12 个月列 + 2 个标签列 = 14 列）
  const dateHeaderCount = headers.filter(isDateHeader).length;
  if (headers.length > 3 && dateHeaderCount / headers.length > 0.4) {
    return "wide";
  }

  // 透视表：抽样检查单元格混杂率（单元格内同时含文字+数字，如"尚进工资：3w*6=39万"）
  const sampleSize = Math.min(rows.length, 20);
  let mixedCount = 0;
  let totalCells = 0;
  for (let i = 0; i < sampleSize; i++) {
    for (const v of Object.values(rows[i])) {
      if (v && String(v).trim().length > 3) {
        totalCells++;
        if (isMixedCell(v)) mixedCount++;
      }
    }
  }
  if (totalCells > 0 && mixedCount / totalCells > 0.25) {
    return "pivot";
  }

  // 简表：列数 ≤ 5 且混杂率低
  if (headers.length <= 5 && mixedCount / Math.max(1, totalCells) < 0.15) {
    return "simple";
  }

  return "standard";
}

// ──────────────── 宽表逆透视 ────────────────

/**
 * 宽表逆透视：label 列固定，其余日期列展开为行。
 * 输入: [{名称:"大宝", "2024-01":5000, "2024-02":5000}, ...]
 * 输出: [{label:"大宝", date:"2024-01-01", amount:5000}, ...]
 *
 * v1.3 修复：当 label 含多值（如"东禾4900+东灿4900"）时，拆成多行，
 * 每个孩子/项目各一条记录。
 */
export function unpivotWide(
  rows: Array<Record<string, string>>,
  headers: string[],
): Array<Record<string, string>> {
  if (headers.length === 0) return rows;
  const labelCol = headers[0]; // 第一列作为 label
  const dateCols = headers.slice(1).filter(isDateHeader);
  if (dateCols.length === 0) return rows;

  const result: Array<Record<string, string>> = [];
  for (const row of rows) {
    const labelRaw = String(row[labelCol] || "").trim();
    if (!labelRaw || isTotalRow(row)) continue;
    for (const col of dateCols) {
      const rawVal = row[col];
      if (rawVal === undefined || rawVal === "" || rawVal === null) continue;
      const date = normalizeDateString(col);
      const amount = String(normalizeAmount(rawVal));
      if (Number(amount) === 0) continue;
      // 检查 label 是否含多值（如"东禾4900+东灿4900"或"东禾、东灿"）
      const subItems = splitMultiValueLabel(labelRaw, rawVal);
      if (subItems.length > 1) {
        // 多值拆分：每个子项各一行
        for (const item of subItems) {
          result.push({ date, label: item.label, amount: String(item.amount), _original_column: col });
        }
      } else {
        result.push({ date, label: labelRaw, amount, _original_column: col });
      }
    }
  }
  return result;
}

/** 拆分多值 label：如"东禾4900+东灿4900" → [{label:"东禾",amount:4900},{label:"东灿",amount:4900}] */
function splitMultiValueLabel(label: string, cellValue: string): Array<{ label: string; amount: number }> {
  // 检测分隔符：+ / 、 / 和 / 加
  const parts = label.split(/[+＋、和加]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return [{ label, amount: normalizeAmount(cellValue) }];

  const result: Array<{ label: string; amount: number }> = [];
  for (const part of parts) {
    // 尝试从子项中提取金额（如"东禾4900"）
    const m = part.match(/^(.+?)([\d,]+(?:\.\d+)?)\s*(万|w|k)?$/);
    if (m) {
      const subLabel = m[1].trim();
      const subAmount = normalizeAmount(part);
      result.push({ label: subLabel, amount: subAmount });
    } else {
      // 子项无金额，用 cellValue 的均值
      result.push({ label: part, amount: Math.round(normalizeAmount(cellValue) / parts.length) });
    }
  }
  return result;
}

/** 将各种日期格式规范化为 YYYY-MM-DD */
function normalizeDateString(s: string): string {
  const str = String(s).trim();
  // 2024-01 / 2024/1
  let m = str.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, "0");
    return `${y}-${mo}-01`;
  }
  // 2024年1月
  m = str.match(/^(\d{4})年(\d{1,2})月$/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-01`;
  }
  // 1月（缺年份，取今年）
  m = str.match(/^(\d{1,2})月$/);
  if (m) {
    const y = new Date().getFullYear();
    return `${y}-${m[1].padStart(2, "0")}-01`;
  }
  // 纯年份 2024
  m = str.match(/^(\d{4})$/);
  if (m) return `${m[1]}-01-01`;
  // 月份英文
  const monthMap: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  if (monthMap[str]) return `${new Date().getFullYear()}-${monthMap[str]}-01`;
  // Q1-Q4
  m = str.match(/^Q([1-4])$/i);
  if (m) {
    const q = parseInt(m[1]);
    const mo = String((q - 1) * 3 + 1).padStart(2, "0");
    return `${new Date().getFullYear()}-${mo}-01`;
  }
  // Excel 序列号
  if (isExcelSerial(str)) return excelSerialToDate(Number(str));
  return str;
}

// ──────────────── 日期/金额字段规范化 ────────────────

/** 规范化单行数据：日期转换 + 金额单位换算 */
function normalizeRowValues(
  row: Record<string, string>,
  mapping: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v;
  }
  // 日期字段：tx_date / snapshot_date / due_date
  for (const dateField of ["tx_date", "snapshot_date", "due_date"]) {
    const col = mapping[dateField];
    if (col && out[col] !== undefined) {
      const v = String(out[col]).trim();
      if (isExcelSerial(v)) {
        out[col] = excelSerialToDate(Number(v));
      } else {
        out[col] = normalizeDateString(v);
      }
    }
  }
  // 金额字段：amount / total_assets / total_liabilities / cash / investment / real_estate / other_assets / interest_rate
  const amountFields = ["amount", "total_assets", "total_liabilities", "cash", "investment", "real_estate", "other_assets"];
  for (const amtField of amountFields) {
    const col = mapping[amtField];
    if (col && out[col] !== undefined && out[col] !== "") {
      const n = normalizeAmount(out[col]);
      if (n !== 0) out[col] = String(n);
    }
  }
  return out;
}

// ──────────────── 表名推断 ────────────────

/** 基于列名/表名推断目标表（v1.3 修复：严格按 header 关键词匹配）*/
export function suggestTable(sheetName: string, headers: string[], mapping: Record<string, string>): string {
  const allHeaders = headers.join(" ");
  const allText = (sheetName + " " + allHeaders);

  // 资产负债快照：含"总资产"/"总负债"/"净资产"/"资产负债率"等关键词
  if (/总资产|总负债|净资产|资产负债率|snapshot|net.?worth/i.test(allText) || mapping.total_assets || mapping.snapshot_date) {
    return "net_worth";
  }
  // 教育基金：含"孩子"/"宝宝"/"教育"/"大宝"/"二宝"等关键词
  if (/教育基金|孩子|宝宝|大宝|二宝|child/i.test(allText) || mapping.child_name) {
    return "education_fund";
  }
  // 债务：含"债权人"/"借入"/"还款"/"利率"/"到期"等关键词
  if (/债权人|借入|还款|借钱|利率|到期|lender|debt/i.test(allText) || mapping.lender || mapping.interest_rate) {
    return "debt";
  }
  // 支出：含"支出"/"消费"/"收款方"等关键词
  if (/支出|消费|花销|收款方|expense|payee/i.test(allText) || mapping.payee) {
    return "expense";
  }
  // 收入（默认）
  if (/收入|工资|salary|income|来源/i.test(allText) || mapping.source) {
    return "income";
  }
  return "income";
}

// ──────────────── 主入口：多 sheet 解析 ────────────────

export function parseUpload(buffer: Buffer, mimetype: string): ParsedUpload {
  // xlsx 本质是 ZIP 压缩包，魔数 PK\x03\x04；比 mimetype 更可靠
  // curl 上传 xlsx 经常被识别为 application/octet-stream
  const isExcelByMime =
    mimetype.includes("spreadsheet") ||
    mimetype.includes("excel") ||
    mimetype.includes("officedocument");
  const isExcelByMagic = buffer.length > 4 &&
    buffer[0] === 0x50 && buffer[1] === 0x4b && // PK
    (buffer[2] === 0x03 || buffer[2] === 0x05) && // \x03 or \x05
    (buffer[3] === 0x04 || buffer[3] === 0x06);   // \x04 or \x06

  if (isExcelByMime || isExcelByMagic) {
    return parseExcel(buffer);
  }
  // CSV：单 sheet
  return parseCsv(buffer);
}

function parseExcel(buffer: Buffer): ParsedUpload {
  const wb = xlsx.read(buffer, { type: "buffer", cellDates: true });
  const sheets: SheetData[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    // raw:false 让 xlsx 用 cellNF 格式化，配合 cellDates 日期变字符串
    const rawRows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    });
    if (rawRows.length === 0) continue;
    const headers = Object.keys(rawRows[0]);
    const stringRows = rawRows.map((r) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) {
        if (v instanceof Date) {
          out[k] = v.toISOString().slice(0, 10);
        } else if (v === null || v === undefined) {
          out[k] = "";
        } else {
          out[k] = String(v).trim();
        }
      }
      return out;
    });
    sheets.push(buildSheetData(sheetName, stringRows, headers));
  }
  return { sheets };
}

function parseCsv(buffer: Buffer): ParsedUpload {
  const text = buffer.toString("utf-8");
  const rawRows = csvParse(text, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>;
  if (rawRows.length === 0) return { sheets: [] };
  const headers = Object.keys(rawRows[0]);
  const stringRows = rawRows.map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = v === null || v === undefined ? "" : String(v).trim();
    }
    return out;
  });
  return { sheets: [buildSheetData("CSV", stringRows, headers)] };
}

/** 构建 SheetData：跑完日期转换→金额换算→总计过滤→形态识别→（宽表逆透视）→列映射推断 */
function buildSheetData(
  name: string,
  rows: Array<Record<string, string>>,
  headers: string[],
): SheetData {
  const notes: string[] = [];

  // 1. 先按原始列名推断 mapping（用于日期/金额字段识别）
  let mapping = inferMapping(headers);

  // 2. 过滤总计行
  const beforeCount = rows.length;
  rows = filterTotalRows(rows);
  if (beforeCount !== rows.length) {
    notes.push(`过滤 ${beforeCount - rows.length} 行总计/合计行`);
  }

  // 3. 形态识别
  let shape = detectShape(headers, rows);

  // 4. 宽表逆透视
  if (shape === "wide") {
    const before = rows.length;
    rows = unpivotWide(rows, headers);
    notes.push(`宽表逆透视：${before} 行 → ${rows.length} 行`);
    // 逆透视后列名变了，重新推断
    const newHeaders = rows.length > 0 ? Object.keys(rows[0]) : [];
    mapping = inferMapping(newHeaders);
    // 手动补全 date/label/amount 映射
    if (!mapping.tx_date && !mapping.snapshot_date) {
      mapping.tx_date = "date";
      mapping.snapshot_date = "date";
    }
    if (!mapping.amount) mapping.amount = "amount";
    // label 列映射到 child_name（教育基金）或 category（其他）
    mapping.child_name = "label";
    mapping.category = "label";
    headers = newHeaders;
  } else {
    // 5. 标准明细：日期/金额规范化
    rows = rows.map((r) => normalizeRowValues(r, mapping));
    if (shape === "pivot") {
      notes.push("透视表形态：将走 LLM 智能提取");
    }
  }

  const suggestedTable = suggestTable(name, headers, mapping);

  return {
    name,
    rows,
    headers,
    inferredMapping: mapping,
    rowCount: rows.length,
    shape,
    suggestedTable,
    notes,
  };
}

// ──────────────── 结构化模式：列映射 + 校验（保留 v1.2）────────────────

export function applyMapping(
  rows: Array<Record<string, string>>,
  mapping: Record<string, string>,
): StructuredRow[] {
  return rows.map((row) => {
    const fields: Record<string, unknown> = {};
    const errors: string[] = [];
    for (const [field, sourceCol] of Object.entries(mapping)) {
      if (sourceCol && row[sourceCol] !== undefined) {
        fields[field] = row[sourceCol];
      }
    }
    // 金额校验
    const amount = normalizeAmount(fields.amount);
    if (!fields.amount || amount <= 0) {
      errors.push("金额缺失或非正数");
    } else {
      fields.amount = amount;
    }
    // 日期校验
    if (!fields.tx_date && !fields.snapshot_date) {
      fields.tx_date = new Date().toISOString().slice(0, 10);
    } else if (fields.tx_date) {
      const d = normalizeDateString(String(fields.tx_date));
      fields.tx_date = d || new Date().toISOString().slice(0, 10);
    } else if (fields.snapshot_date) {
      const d = normalizeDateString(String(fields.snapshot_date));
      fields.snapshot_date = d || new Date().toISOString().slice(0, 10);
    }
    // 分类缺省
    if (!fields.category) {
      fields.category = "其他";
    }
    return { fields, valid: errors.length === 0, errors };
  });
}
