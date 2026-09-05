import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod/v4";

const router = Router();
const bcryptRounds = 10;

type SessionUser = {
  id: number;
  email: string;
  displayName: string;
  role: "admin" | "user";
  isActive: boolean;
};

function allowedEmails(): Set<string> {
  return new Set(
    (process.env.WIKI_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

// When the allowlist is non-empty, only listed emails may register/sign in.
// When it is empty, registration is open (future expansion).
function assertAllowed(email: string): void {
  const allow = allowedEmails();
  if (allow.size > 0 && !allow.has(email.toLowerCase())) {
    throw new HttpError(403, "Your email is not on the allowlist.");
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function sessionView(u: typeof usersTable.$inferSelect): SessionUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role as "admin" | "user",
    isActive: u.isActive,
  };
}

function safeUser(u: typeof usersTable.$inferSelect): SessionUser {
  return sessionView(u);
}

// First registered user becomes admin.
async function pickRole(): Promise<"admin" | "user"> {
  const existing = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  return existing.length === 0 ? "admin" : "user";
}

// POST /api/auth/register
router.post("/auth/register", async (req, res) => {
  try {
    const parsed = z
      .object({
        email: z.email(),
        password: z.string().min(8),
        displayName: z.string().min(1).max(60),
      })
      .parse(req.body);
    const email = parsed.email.toLowerCase();
    assertAllowed(email);

    const [exists] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email));
    if (exists) return res.status(409).json({ error: "Email already registered" });

    const passwordHash = await bcrypt.hash(parsed.password, bcryptRounds);
    const role = await pickRole();
    const [u] = await db
      .insert(usersTable)
      .values({ email, passwordHash, displayName: parsed.displayName, role })
      .returning();
    req.session.user = sessionView(u);
    res.json(safeUser(u));
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid input" });
    return res.status(500).json({ error: "Registration failed" });
  }
});

// POST /api/auth/login
router.post("/auth/login", async (req, res) => {
  try {
    const parsed = z
      .object({ email: z.email(), password: z.string().min(1) })
      .parse(req.body);
    const email = parsed.email.toLowerCase();
    const [u] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));
    if (!u || !u.passwordHash) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    if (!u.isActive) return res.status(403).json({ error: "Account disabled" });
    const ok = await bcrypt.compare(parsed.password, u.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    await db
      .update(usersTable)
      .set({ lastLoginAt: new Date() })
      .where(eq(usersTable.id, u.id));
    req.session.user = sessionView(u);
    res.json(safeUser(u));
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid input" });
    return res.status(500).json({ error: "Login failed" });
  }
});

// POST /api/auth/google — receives a GIS ID token.
router.post("/auth/google", async (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(503).json({ error: "Google login not configured" });
    }
    const { credential } = z
      .object({ credential: z.string().min(1) })
      .parse(req.body);

    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email_verified || !payload.email) {
      return res.status(400).json({ error: "Email not verified by Google" });
    }
    const email = payload.email.toLowerCase();
    assertAllowed(email);

    // 1) match by google subject
    let [u] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.googleSubject, payload.sub));
    if (u) {
      if (!u.isActive) return res.status(403).json({ error: "Account disabled" });
    } else {
      // 2) match by email (previously registered with password)
      [u] = await db.select().from(usersTable).where(eq(usersTable.email, email));
      if (u) {
        if (!u.isActive) return res.status(403).json({ error: "Account disabled" });
        await db
          .update(usersTable)
          .set({ googleSubject: payload.sub, lastLoginAt: new Date() })
          .where(eq(usersTable.id, u.id));
        u.googleSubject = payload.sub;
      } else {
        // 3) create new google-only user
        const role = await pickRole();
        [u] = await db
          .insert(usersTable)
          .values({
            email,
            displayName: payload.name ?? payload.email,
            role,
            googleSubject: payload.sub,
            passwordHash: null,
          })
          .returning();
      }
    }

    await db
      .update(usersTable)
      .set({ lastLoginAt: new Date() })
      .where(eq(usersTable.id, u.id));
    req.session.user = sessionView(u);
    res.json(safeUser(u));
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid input" });
    return res.status(500).json({ error: "Google login failed" });
  }
});

// POST /api/auth/logout
router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("tc.sid");
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get("/auth/me", (req, res) => {
  if (req.session?.user) return res.json(req.session.user);
  return res.status(401).json({ error: "Not authenticated" });
});

// GET /api/auth/verify — internal endpoint for nginx auth_request.
// Returns 200 if authenticated (session or API key), 401 otherwise.
// NOT in PUBLIC_PATHS, so authMiddleware protects it.
router.get("/auth/verify", (req, res) => {
  res.status(200).json({ ok: true, actor: req.actor ?? null });
});

export default router;
