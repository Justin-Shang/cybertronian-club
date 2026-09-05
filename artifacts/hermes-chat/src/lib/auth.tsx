import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type Context,
  type ReactNode,
} from "react";

export type CurrentUser = {
  id: number;
  email: string;
  displayName: string;
  role: "admin" | "user";
} | null;

type AuthCtx = {
  user: CurrentUser;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  loginGoogle: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx: Context<AuthCtx> = createContext<AuthCtx>(null!);

export const useAuth = () => useContext(Ctx);

async function readError(r: Response): Promise<string> {
  try {
    const e = (await r.json()) as { error?: string };
    return e.error ?? "Request failed";
  } catch {
    return "Request failed";
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (r.ok) {
        setUser((await r.json()) as CurrentUser);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (email: string, password: string) => {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(await readError(r));
    setUser((await r.json()) as CurrentUser);
  };

  const register = async (email: string, password: string, displayName: string) => {
    const r = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password, displayName }),
    });
    if (!r.ok) throw new Error(await readError(r));
    setUser((await r.json()) as CurrentUser);
  };

  const loginGoogle = async (credential: string) => {
    const r = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ credential }),
    });
    if (!r.ok) throw new Error(await readError(r));
    setUser((await r.json()) as CurrentUser);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ user, loading, login, register, loginGoogle, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}
