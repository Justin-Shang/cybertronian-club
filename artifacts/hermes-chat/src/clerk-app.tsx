// Clerk 认证路径（仅在 VITE_CLERK_PUBLISHABLE_KEY 配置时按需懒加载）。
// 此文件静态 import @clerk/react 与 @clerk/themes，因此必须在配置密钥后才加载，
// 否则 no-auth 模式构建不会依赖这两个包。
import { useEffect, useRef, useState } from "react";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  Show,
  useClerk,
  useUser,
} from "@clerk/react";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { AppRouter, basePath, clerkPubKey, clerkProxyUrl, queryClient } from "./App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    socialButtonsVariant: "blockButton" as const,
  },
  variables: {
    colorPrimary: "hsl(222 84% 60%)",
    fontFamily: "inherit",
    borderRadius: "0.5rem",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={basePath + "/sign-in"}
        signUpUrl={basePath + "/sign-up"}
        fallbackRedirectUrl={basePath || "/"}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={basePath + "/sign-up"}
        signInUrl={basePath + "/sign-in"}
        fallbackRedirectUrl={basePath || "/"}
      />
    </div>
  );
}

function NotAuthorized() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-5 flex items-center justify-center">
          <ShieldAlert className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="mb-2 text-lg font-semibold text-foreground">Access not authorized</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          {email ? (
            <>The account <span className="font-medium">{email}</span> isn't authorized for this app.</>
          ) : (
            <>This account isn't authorized for this app.</>
          )}
        </p>
        <button
          type="button"
          onClick={() => signOut({ redirectUrl: basePath || "/" })}
          className="w-full rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function AuthedApp() {
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    const onForbidden = () => setForbidden(true);
    window.addEventListener("app:forbidden", onForbidden);
    return () => window.removeEventListener("app:forbidden", onForbidden);
  }, []);

  if (forbidden) return <NotAuthorized />;
  return <AppRouter />;
}

function Landing() {
  const [, setLocation] = useLocation();
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground text-sm font-bold">H</span>
          </div>
          <span className="text-xl font-semibold text-foreground">Hermes</span>
        </div>
        <p className="mb-8 text-sm text-muted-foreground">
          Multi-agent group chat. Sign in to continue.
        </p>
        <button
          type="button"
          onClick={() => setLocation("/sign-in")}
          className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Sign in
        </button>
      </div>
    </div>
  );
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route>
        <Show when="signed-out">
          <Landing />
        </Show>
        <Show when="signed-in">
          <AuthedApp />
        </Show>
      </Route>
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={basePath + "/sign-in"}
      signUpUrl={basePath + "/sign-up"}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <AppRoutes />
          <Toaster richColors position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default function ClerkApp() {
  return <ClerkProviderWithRoutes />;
}
