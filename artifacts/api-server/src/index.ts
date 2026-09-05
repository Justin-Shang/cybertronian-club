import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // 启动 Finance 周期规则调度器：立即跑一次补漏 + 每 24h 检查
  import("./lib/finance-recurring").then(({ processRecurringRules }) => {
    processRecurringRules(logger).catch((e) => logger.error({ err: e }, "recurring initial run failed"));
    setInterval(() => {
      processRecurringRules(logger).catch((e) => logger.error({ err: e }, "recurring scheduled run failed"));
    }, 24 * 60 * 60 * 1000);
    logger.info("Finance recurring scheduler started");
  }).catch((e) => logger.error({ err: e }, "finance-recurring module load failed"));

  // 启动 Invest 每周初筛调度器：立即检查一次 + 每 24h 检查 nextRunDate
  import("./lib/invest-screen").then(({ processScreenConfigs }) => {
    processScreenConfigs(logger).catch((e) => logger.error({ err: e }, "screening initial run failed"));
    setInterval(() => {
      processScreenConfigs(logger).catch((e) => logger.error({ err: e }, "screening scheduled run failed"));
    }, 24 * 60 * 60 * 1000);
    logger.info("Invest screening scheduler started");
  }).catch((e) => logger.error({ err: e }, "invest-screen module load failed"));
});
