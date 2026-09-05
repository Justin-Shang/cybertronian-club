// StatPilot 代理路由：/api/statpilot/* → Python 微服务 (127.0.0.1:5080)
// 复用 Express 全局鉴权（/api 前缀 authMiddleware），Python 服务只监听本机
import { Router, type Request, type Response } from "express";
import http from "node:http";

const router = Router();

const UPSTREAM_HOST = process.env.STATPILOT_HOST || "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.STATPILOT_PORT || "5080");

router.use("/statpilot", (req: Request, res: Response) => {
  // 构造上游路径：/statpilot/nba/... → /nba/...
  const upstreamPath = req.originalUrl.replace(/^\/api\/statpilot/, "") || "/";
  const queryIdx = upstreamPath.indexOf("?");
  const path = queryIdx >= 0 ? upstreamPath.slice(0, queryIdx) : upstreamPath;
  const search = queryIdx >= 0 ? upstreamPath.slice(queryIdx) : "";

  // Express body-parser 已解析请求体，直接用 req.body（不能用流收集，流已被消费）
  const body =
    req.body !== undefined && req.body !== null
      ? Buffer.from(JSON.stringify(req.body))
      : undefined;

  const upstreamReq = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: path + search,
      headers: {
        ...req.headers,
        host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
        ...(body ? { "content-length": String(body.length) } : {}),
      },
      timeout: 120_000, // 数据管道/LLM 生成可能较慢
    },
    (upstreamRes) => {
      res.status(upstreamRes.statusCode || 502);
      upstreamRes.headers && Object.entries(upstreamRes.headers).forEach(([k, v]) => {
        if (k.toLowerCase() === "transfer-encoding") return;
        if (v !== undefined) res.setHeader(k, v);
      });
      upstreamRes.pipe(res);
    }
  );
  upstreamReq.on("timeout", () => upstreamReq.destroy(new Error("upstream timeout")));
  upstreamReq.on("error", (err) => {
    req.log && req.log.error({ err }, "statpilot upstream error");
    res.status(502).json({ error: "StatPilot 上游服务不可用" });
  });
  if (body) upstreamReq.write(body);
  upstreamReq.end();
});

export default router;
