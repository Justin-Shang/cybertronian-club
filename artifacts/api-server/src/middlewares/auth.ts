import { Request, Response, NextFunction } from "express";
import { db, agentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Previously-exposed keys that must never be accepted. Loaded from
// WIKI_REVOKED_KEYS (comma-separated). Read fresh each call.
function revokedKeys(): Set<string> {
  return new Set(
    (process.env.WIKI_REVOKED_KEYS ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
}

const NAMED_VARS: Record<string, string> = {
  WIKI_KEY_ADMIN: "Admin",
  WIKI_KEY_HERMES_1: "擎天柱",
  WIKI_KEY_HERMES_2: "通天晓",
  WIKI_KEY_HERMES_3: "补天士",
  WIKI_KEY_HERMES_4: "阿尔茜",
  WIKI_KEY_HERMES_5: "大黄蜂",
};

// Unified Agent key lookup: env named vars → WIKI_API_KEYS → DB agents.api_key.
// Env path is synchronous and backwards-compatible; DB path supports future
// external agents registered in the agents table.
async function lookupActor(token: string): Promise<string | undefined> {
  const revoked = revokedKeys();
  if (!token || revoked.has(token)) return undefined;

  for (const [envVar, actor] of Object.entries(NAMED_VARS)) {
    const key = (process.env[envVar] ?? "").trim();
    if (key && key === token && !revoked.has(key)) return actor;
  }

  for (const entry of (process.env.WIKI_API_KEYS ?? "").split(",")) {
    const e = entry.trim();
    if (!e) continue;
    const colonIdx = e.indexOf(":");
    if (colonIdx > 0) {
      const actor = e.slice(0, colonIdx).trim();
      const key = e.slice(colonIdx + 1).trim();
      if (key === token && !revoked.has(key)) return actor;
    } else {
      if (e === token && !revoked.has(e)) return "Unknown";
    }
  }

  // DB agents.api_key — supports internal & future external agents.
  try {
    const [agent] = await db
      .select({ name: agentsTable.name })
      .from(agentsTable)
      .where(eq(agentsTable.apiKey, token));
    if (agent) return agent.name;
  } catch {
    // ignore DB errors (e.g. table missing during bootstrap)
  }

  return undefined;
}

// Public endpoints that skip authentication.
const PUBLIC_PATHS = new Set(["/auth/login", "/auth/register", "/auth/google"]);

function isPublic(path: string): boolean {
  if (path === "/healthz") return true;
  return PUBLIC_PATHS.has(path);
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (isPublic(req.path)) return next();

  // 1) API key (Authorization Bearer or X-API-Key) — Agents & MCP clients.
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : ((req.headers["x-api-key"] as string | undefined) ?? "");
  if (token) {
    const actor = await lookupActor(token);
    if (actor) {
      req.actor = actor;
      return next();
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  // 2) Human web session.
  const u = req.session?.user;
  if (u && u.isActive) {
    req.actor = u.role === "admin" ? "Admin" : u.displayName;
    req.user = u;
    return next();
  }

  // 3) Dev fallback — only when not in production and no SESSION_SECRET is set.
  if (process.env.NODE_ENV !== "production" && !process.env.SESSION_SECRET) {
    req.actor = "Dev";
    return next();
  }

  return res.status(401).json({ error: "Unauthorized" });
}
