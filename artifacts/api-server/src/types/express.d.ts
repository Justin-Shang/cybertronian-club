type SessionUser = {
  id: number;
  email: string;
  displayName: string;
  role: "admin" | "user";
  isActive: boolean;
};

declare global {
  namespace Express {
    interface Request {
      actor?: string;
      user?: SessionUser;
    }
  }
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
  }
}

export {};
