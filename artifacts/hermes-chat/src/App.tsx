import { lazy, Suspense, useEffect, type ReactNode } from "react";
import KanbanPage from "@/pages/kanban";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import FinanceOverview from "@/pages/finance";
import FinanceIncome from "@/pages/finance/income";
import FinanceExpense from "@/pages/finance/expense";
import FinanceNetWorth from "@/pages/finance/net-worth";
import FinanceEducationFund from "@/pages/finance/education-fund";
import FinanceDebt from "@/pages/finance/debt";
import FinanceRecurring from "@/pages/finance/recurring-rules";
import FinanceScenarios from "@/pages/finance/scenarios";
import FinanceNLQuery from "@/pages/finance/nl-query";
import FinanceImport from "@/pages/finance/import";
import ModelRouterIndex from "@/pages/model-router";
import CybertronRouter from "@/pages/model-router/cybertron";
import HermesRouter from "@/pages/model-router/hermes";
import PriceCompare from "@/pages/model-router/prices";
import ChatPage from "@/pages/chat";
import AgentsPage from "@/pages/agents";
import RoomsPage from "@/pages/rooms";
import GamesPage from "@/pages/games";
import GameRoomPage from "@/pages/games/room";
import GobangPage from "@/pages/gobang";
import TwentyFourPage from "@/pages/twenty-four";
import SquarePage from "@/pages/square";
import WikiHome from "@/pages/wiki/home";
import WikiPagesList from "@/pages/wiki/pages-list";
import WikiPageView from "@/pages/wiki/page-view";
import WikiPageForm from "@/pages/wiki/page-form";
import WikiAuditLog from "@/pages/wiki/audit-log";
import KnowledgeGraphs from "@/pages/graphs/index";
import GraphView from "@/pages/graphs/view";
import FuturePage from "@/pages/future/index";
import WorkflowsList from "@/pages/workflows/index";
import NewWorkflow from "@/pages/workflows/new";
import WorkflowDetail from "@/pages/workflows/[id]";
import ExecutionMonitor from "@/pages/workflows/execution/[id]";
import WorkflowsAgentsPage from "@/pages/workflows/agents";
import InvestOverview from "@/pages/invest";
import WatchlistPage from "@/pages/invest/watchlist";
import CandidatesPage from "@/pages/invest/candidates";
import StockDetailPage from "@/pages/invest/stock-detail";
import FrameworksPage from "@/pages/invest/frameworks";
import NotesPage from "@/pages/invest/notes";
import AlertsPage from "@/pages/invest/alerts";
import ScreeningPage from "@/pages/invest/screening";
import StatpilotHome from "@/pages/statpilot";
import StatpilotNba from "@/pages/statpilot/nba";
import StatpilotNfl from "@/pages/statpilot/nfl";
import { AuthProvider, useAuth } from "@/lib/auth";

export const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "";
export const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
export const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});
export { queryClient };

// 全路由表（无 clerk 依赖）：no-auth 模式直接渲染，clerk 模式由 clerk-app.tsx 复用
export function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={ChatPage} />
      <Route path="/room/:roomId" component={ChatPage} />
      <Route path="/agents" component={AgentsPage} />
      <Route path="/rooms" component={RoomsPage} />
      <Route path="/games" component={GamesPage} />
      <Route path="/games/room/:sessionId" component={GameRoomPage} />
      <Route path="/games/gobang" component={GobangPage} />
      <Route path="/games/twentyfour" component={TwentyFourPage} />
      <Route path="/square" component={SquarePage} />
      <Route path="/wiki" component={WikiHome} />
      <Route path="/wiki/pages" component={WikiPagesList} />
      <Route path="/wiki/pages/new" component={WikiPageForm} />
      <Route path="/wiki/pages/:id" component={WikiPageView} />
      <Route path="/wiki/pages/:id/edit" component={WikiPageForm} />
      <Route path="/wiki/audit" component={WikiAuditLog} />
      <Route path="/graphs" component={KnowledgeGraphs} />
      <Route path="/graphs/:id" component={GraphView} />
      <Route path="/future" component={FuturePage} />
      <Route path="/invest" component={InvestOverview} />
      <Route path="/invest/watchlist" component={WatchlistPage} />
      <Route path="/invest/candidates" component={CandidatesPage} />
      <Route path="/invest/stocks/:code" component={StockDetailPage} />
      <Route path="/invest/frameworks" component={FrameworksPage} />
      <Route path="/invest/notes" component={NotesPage} />
      <Route path="/invest/alerts" component={AlertsPage} />
      <Route path="/invest/screening" component={ScreeningPage} />
      <Route path="/statpilot" component={StatpilotHome} />
      <Route path="/statpilot/nba" component={StatpilotNba} />
      <Route path="/statpilot/nfl" component={StatpilotNfl} />
      <Route path="/workflows" component={WorkflowsList} />
      <Route path="/workflows/new" component={NewWorkflow} />
      <Route path="/kanban" component={KanbanPage} />
      <Route path="/workflows/agents" component={WorkflowsAgentsPage} />
      <Route path="/workflows/execution/:id" component={ExecutionMonitor} />
      <Route path="/workflows/:id" component={WorkflowDetail} />
      <Route path="/finance" component={FinanceOverview} />
      <Route path="/finance/income" component={FinanceIncome} />
      <Route path="/finance/expense" component={FinanceExpense} />
      <Route path="/finance/net-worth" component={FinanceNetWorth} />
      <Route path="/finance/education-fund" component={FinanceEducationFund} />
      <Route path="/finance/debt" component={FinanceDebt} />
      <Route path="/finance/recurring" component={FinanceRecurring} />
      <Route path="/finance/scenarios" component={FinanceScenarios} />
      <Route path="/finance/query" component={FinanceNLQuery} />
      <Route path="/finance/import" component={FinanceImport} />
      <Route path="/model-router" component={ModelRouterIndex} />
      <Route path="/model-router/cybertron" component={CybertronRouter} />
      <Route path="/model-router/hermes" component={HermesRouter} />
      <Route path="/model-router/prices" component={PriceCompare} />
      <Route path="/sign-in" component={SignInPage} />
      <Route path="/sign-up" component={SignUpPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

// Clerk 认证路径：懒加载 clerk-app.tsx（内部静态 import @clerk/react + @clerk/themes）。
// 这两个包在 vite.config.ts 中被声明为 external，build 无需安装即可通过；
// no-auth 模式下（clerkPubKey 为空）本 lazy 永不渲染，clerk-app chunk 不会被加载，
// 因此运行时也不会触发对外部 @clerk/react 的解析。
const ClerkApp = lazy(() => import("./clerk-app").then((m) => ({ default: m.default })));

function FullPageSpinner() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
      <div className="text-sm text-muted-foreground">Loading…</div>
    </div>
  );
}

// no-auth 模式守卫：未登录时跳转登录页，避免接口 401 导致页面空白
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [location, setLocation] = useLocation();
  const isAuthPage = location.endsWith("/sign-in") || location.endsWith("/sign-up");
  useEffect(() => {
    if (!loading && !user && !isAuthPage) setLocation("/sign-in");
  }, [loading, user, isAuthPage, setLocation]);
  if (loading) return <FullPageSpinner />;
  return <>{children}</>;
}

export default function App() {
  // no-auth 模式：直接用 AppRouter，不依赖任何 clerk 包
  if (!clerkPubKey) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={basePath}>
            <RequireAuth>
              <AppRouter />
            </RequireAuth>
          </WouterRouter>
          <Toaster richColors position="top-right" />
        </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    );
  }

  // clerk 模式：懒加载 clerk-app.tsx
  return (
    <WouterRouter base={basePath}>
      <Suspense fallback={<FullPageSpinner />}>
        <ClerkApp />
      </Suspense>
    </WouterRouter>
  );
}
