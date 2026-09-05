import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/auth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ credentials: true, origin: true }));

app.use("/api/mcp", express.json({ limit: "15mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session store (PostgreSQL-backed). Dev fallback secret is only used outside
// production; production requires SESSION_SECRET to be set.
const sessionSecret =
  process.env.SESSION_SECRET ??
  (process.env.NODE_ENV === "production"
    ? undefined
    : "dev-only-secret-not-for-production");
if (!sessionSecret) {
  throw new Error("SESSION_SECRET must be set in production");
}

const PgSessionStore = connectPgSimple(session);
app.use(cookieParser());
app.use(
  session({
    name: "tc.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new PgSessionStore({ pool, tableName: "user_sessions" }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.SESSION_COOKIE_SECURE === "true",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    },
  }),
);

app.use("/api", authMiddleware);
app.use("/api", router);

export default app;
