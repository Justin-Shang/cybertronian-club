import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import ChatPage from "@/pages/chat";
import AgentsPage from "@/pages/agents";
import RoomsPage from "@/pages/rooms";
import GamesPage from "@/pages/games";
import GobangPage from "@/pages/gobang";
import TwentyFourPage from "@/pages/twenty-four";
import SquarePage from "@/pages/square";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={ChatPage} />
      <Route path="/room/:roomId" component={ChatPage} />
      <Route path="/agents" component={AgentsPage} />
      <Route path="/rooms" component={RoomsPage} />
      <Route path="/games" component={GamesPage} />
      <Route path="/games/gobang" component={GobangPage} />
      <Route path="/games/twentyfour" component={TwentyFourPage} />
      <Route path="/square" component={SquarePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster richColors position="top-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
