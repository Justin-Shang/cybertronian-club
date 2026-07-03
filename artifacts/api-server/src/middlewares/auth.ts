import { Request, Response, NextFunction } from "express";

// Previously-exposed keys that must never be accepted, regardless of what
// environment variables contain. Loaded from the WIKI_REVOKED_KEYS secret
// (comma-separated) so no key material lives in source control. Read fresh
// each call so updates take effect without a restart.
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

// Read key→actor map fresh from environment on every call so that secret
// updates take effect without restarting the server.
function lookupActor(token: string): string | undefined {
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

  return undefined;
}

// Email allowlist for human web sign-in. Read fresh each call so updating the
// WIKI_ALLOWED_EMAILS env var takes effect without a restart.
function allowedEmails(): Set<string> {
  return new Set(
    (process.env.WIKI_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

// Cache Clerk user → primary email lookups so we don't hit the Clerk API on
// every request from a signed-in human.
const EMAIL_TTL_MS = 5 * 60 * 1000;
const emailCache = new Map<string, { email: string | null; exp: number }>();

async function getUserEmail(userId: string): Promise<string | null> {
  const now = Date.now();
  const cached = emailCache.get(userId);
  if (cached && cached.exp > now) return cached.email;

  try {
    // Dynamically import clerkClient only when Clerk is configured
    const { clerkClient } = await import("@clerk/express");
    const user = await clerkClient.users.getUser(userId);
    const email = user.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null;
    emailCache.set(userId, { email, exp: now + EMAIL_TTL_MS });
    return email;
  } catch {
    return null;
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Public endpoint: health check only.
  if (req.path === "/healthz") return next();

  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : ((req.headers["x-api-key"] as string | undefined) ?? "");

  // Agents and direct API clients (including MCP) authenticate with API keys.
  if (token) {
    const actor = lookupActor(token);
    if (actor) {
      req.actor = actor;
      return next();
    }
    // A bearer token was presented but is not a valid API key.
    return res.status(401).json({ error: "Unauthorized" });
  }

  // If Clerk is not configured, allow all requests through (dev mode without auth).
  if (!process.env.CLERK_SECRET_KEY) {
    req.actor = "Dev";
    return next();
  }

  // Human web sessions authenticate via the Clerk session cookie. Access is
  // gated by an email allowlist so only authorized people reach the wiki.
  const { getAuth } = await import("@clerk/express");
  const auth = getAuth(req);
  if (auth?.userId) {
    const email = await getUserEmail(auth.userId);
    if (email && allowedEmails().has(email)) {
      req.actor = "Admin";
      return next();
    }
    return res
      .status(403)
      .json({ error: "Your account is not authorized for this wiki." });
  }

  return res.status(401).json({ error: "Unauthorized" });
}
