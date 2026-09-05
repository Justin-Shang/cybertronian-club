/**
 * 应用模块注册表（唯一真理来源）。
 *
 * 新增模块只需在此追加一项，全局 Layout 的 Activity Bar / Drawer / Launcher
 * 均自动渲染，无需改各组件。
 *
 * - icon: Activity Bar / Launcher 用
 * - path: 模块入口路径（"/" 精确匹配，其余前缀匹配）
 * - group: Launcher 九宫格分组
 * - defaultPin: 是否默认钉到 Activity Bar（P1 起用户可自行调整）
 * - nav: 模块子页面（Drawer 渲染）；为空则 Drawer 显示空状态
 * - customSidebar: 模块自带侧边栏（如 Wiki page tree），全局 Drawer 自动隐藏避免三层叠加
 */
import type { LucideIcon } from "lucide-react";
import {
  MessageSquare, Hash, Sparkles, Gamepad2, BookOpen, Telescope,
  Share2, Columns2, TrendingUp, Wallet, Workflow, Route, Dribbble,
} from "lucide-react";

export interface ModuleNavItem {
  label: string;
  path: string;
  icon?: LucideIcon;
}

export interface AppModule {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  group: "常用" | "工具" | "内容" | "娱乐";
  defaultPin: boolean;
  description?: string;
  nav?: ModuleNavItem[];
  customSidebar?: boolean;
  /** 覆盖默认前缀匹配逻辑（如 chat 需匹配 /room/:id） */
  match?: (path: string) => boolean;
}

export const modules: AppModule[] = [
  {
    id: "chat",
    label: "Chat",
    icon: MessageSquare,
    path: "/",
    group: "常用",
    defaultPin: true,
    description: "与 Agent 对话",
    match: (p) => p === "/" || p.startsWith("/room/"),
  },
  {
    id: "rooms",
    label: "Rooms",
    icon: Hash,
    path: "/rooms",
    group: "常用",
    defaultPin: true,
  },
  {
    id: "square",
    label: "Square",
    icon: Sparkles,
    path: "/square",
    group: "常用",
    defaultPin: true,
  },
  {
    id: "games",
    label: "Games",
    icon: Gamepad2,
    path: "/games",
    group: "娱乐",
    defaultPin: true,
  },
  {
    id: "wiki",
    label: "Wiki",
    icon: BookOpen,
    path: "/wiki",
    group: "内容",
    defaultPin: true,
    customSidebar: true,
    description: "知识库 · 自带页面树",
  },
  {
    id: "future",
    label: "Future",
    icon: Telescope,
    path: "/future",
    group: "内容",
    defaultPin: true,
  },
  {
    id: "graphs",
    label: "Graphs",
    icon: Share2,
    path: "/graphs",
    group: "内容",
    defaultPin: true,
  },
  {
    id: "kanban",
    label: "Kanban",
    icon: Columns2,
    path: "/kanban",
    group: "工具",
    defaultPin: true,
  },
  {
    id: "invest",
    label: "Invest",
    icon: TrendingUp,
    path: "/invest",
    group: "工具",
    defaultPin: true,
    description: "投资笔记",
    nav: [
      { label: "总览", path: "/invest" },
      { label: "资源池", path: "/invest/watchlist" },
      { label: "候选池", path: "/invest/candidates" },
      { label: "初筛", path: "/invest/screening" },
      { label: "投研笔记", path: "/invest/notes" },
      { label: "框架", path: "/invest/frameworks" },
      { label: "预警", path: "/invest/alerts" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: Wallet,
    path: "/finance",
    group: "工具",
    defaultPin: true,
    description: "家庭财务记录",
    nav: [
      { label: "总览", path: "/finance" },
      { label: "收入", path: "/finance/income" },
      { label: "支出", path: "/finance/expense" },
      { label: "资产负债", path: "/finance/net-worth" },
      { label: "教育基金", path: "/finance/education-fund" },
      { label: "债务", path: "/finance/debt" },
      { label: "周期规则", path: "/finance/recurring" },
      { label: "情景预测", path: "/finance/scenarios" },
      { label: "智能查询", path: "/finance/query" },
      { label: "导入", path: "/finance/import" },
    ],
  },
  {
    id: "workflows",
    label: "Workflows",
    icon: Workflow,
    path: "/workflows",
    group: "工具",
    defaultPin: true,
  },
  {
    id: "model-router",
    label: "Router",
    icon: Route,
    path: "/model-router",
    group: "工具",
    defaultPin: true,
    description: "模型路由策略配置",
    nav: [
      { label: "Cybertron", path: "/model-router/cybertron" },
      { label: "Hermes", path: "/model-router/hermes" },
      { label: "价格对比", path: "/model-router/prices" },
    ],
  },
  {
    id: "statpilot",
    label: "StatPilot",
    icon: Dribbble,
    path: "/statpilot",
    group: "工具",
    defaultPin: true,
    description: "体育数据分析 · NBA / NFL",
    nav: [
      { label: "总览", path: "/statpilot" },
      { label: "NBA 分析", path: "/statpilot/nba" },
      { label: "NFL 分析", path: "/statpilot/nfl" },
    ],
  },
];

/** 按路径定位当前模块。优先自定义 match，其次精确，最后前缀（最长优先，排除 "/"）。 */
export function findModuleByPath(path: string): AppModule | undefined {
  const custom = modules.find((m) => m.match && m.match(path));
  if (custom) return custom;
  const exact = modules.find((m) => m.path === path);
  if (exact) return exact;
  // 前缀匹配，最长 path 优先（避免 /invest 被 / 误匹配）
  const prefix = modules
    .filter((m) => m.path !== "/" && path.startsWith(m.path))
    .sort((a, b) => b.path.length - a.path.length);
  return prefix[0];
}

/** Activity Bar 默认钉住的模块（保持现状顺序，零回归）。 */
export const pinnedModules = modules.filter((m) => m.defaultPin);
