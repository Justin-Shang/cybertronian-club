/**
 * Finance 周期规则执行器。
 *
 * 进程内 setInterval（24h）调度，启动时立即跑一次补漏。
 * next_run_date 持久化在 DB，重启幂等。
 */
import { db, financeRecurringRulesTable, financeIncomeTable, financeExpenseTable } from "@workspace/db";
import { eq, and, lte, or, isNull, gte } from "drizzle-orm";
import type { Logger } from "pino";

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/** 推进 next_run_date：monthly 下月同 day_of_month（31号短月取月末），weekly +7天，yearly 下年同日 */
export function advanceNextRun(
  frequency: string,
  currentDate: string,
  dayOfMonth: number | null,
): string {
  const d = new Date(currentDate + "T00:00:00Z");
  if (frequency === "monthly") {
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1; // 下月（0-based → +1）
    const dom = dayOfMonth ?? 1;
    // 该月最后一天：new Date(year, month+1, 0) 的 getDate()（month 0-based，month+1 的 0 号 = 下月最后一天）
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const actualDay = Math.min(dom, lastDay);
    return new Date(Date.UTC(year, month, actualDay)).toISOString().slice(0, 10);
  }
  if (frequency === "weekly") {
    return new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  // yearly
  return new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

/** 处理所有到期规则：生成 income/expense 行 + 推进 next_run_date */
export async function processRecurringRules(log?: Logger): Promise<{ processed: number; generated: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const rules = await db
    .select()
    .from(financeRecurringRulesTable)
    .where(
      and(
        eq(financeRecurringRulesTable.active, true),
        lte(financeRecurringRulesTable.nextRunDate, today),
        or(isNull(financeRecurringRulesTable.endDate), gte(financeRecurringRulesTable.endDate, today)),
      ),
    );

  let generated = 0;
  for (const rule of rules) {
    try {
      const insertData = {
        txDate: rule.nextRunDate,
        amount: rule.amount,
        category: rule.category || "其他",
        source: rule.source,
        note: `${rule.name}（周期自动入账）`,
        generated: true,
        recurringRuleId: rule.id,
      };

      if (rule.targetTable === "expense") {
        const threshold = Number(process.env.FINANCE_MAJOR_THRESHOLD || "10000");
        await db.insert(financeExpenseTable).values({
          ...insertData,
          isMajor: num(rule.amount) >= threshold,
          payee: null,
        });
      } else {
        await db.insert(financeIncomeTable).values(insertData);
      }
      generated++;

      // 推进 next_run_date（可能跨越多个月，循环到未来日期）
      let next = advanceNextRun(rule.frequency, rule.nextRunDate, rule.dayOfMonth);
      // 如果还过期（进程停机很久），继续推进直到未来
      while (next <= today) {
        next = advanceNextRun(rule.frequency, next, rule.dayOfMonth);
      }
      await db
        .update(financeRecurringRulesTable)
        .set({ nextRunDate: next })
        .where(eq(financeRecurringRulesTable.id, rule.id));
    } catch (err) {
      log?.error({ err, ruleId: rule.id }, "recurring rule process failed");
    }
  }

  if (rules.length > 0) {
    log?.info({ processed: rules.length, generated }, "recurring rules processed");
  }
  return { processed: rules.length, generated };
}

/** 手动触发单条规则：生成一行 + 推进一次 next_run_date */
export async function runRuleOnce(ruleId: number): Promise<{ generated: boolean; nextRunDate: string }> {
  const [rule] = await db
    .select()
    .from(financeRecurringRulesTable)
    .where(eq(financeRecurringRulesTable.id, ruleId))
    .limit(1);
  if (!rule) throw new Error("规则不存在");

  const insertData = {
    txDate: rule.nextRunDate,
    amount: rule.amount,
    category: rule.category || "其他",
    source: rule.source,
    note: `${rule.name}（手动触发）`,
    generated: true,
    recurringRuleId: rule.id,
  };

  if (rule.targetTable === "expense") {
    const threshold = Number(process.env.FINANCE_MAJOR_THRESHOLD || "10000");
    await db.insert(financeExpenseTable).values({
      ...insertData,
      isMajor: num(rule.amount) >= threshold,
      payee: null,
    });
  } else {
    await db.insert(financeIncomeTable).values(insertData);
  }

  const next = advanceNextRun(rule.frequency, rule.nextRunDate, rule.dayOfMonth);
  await db
    .update(financeRecurringRulesTable)
    .set({ nextRunDate: next })
    .where(eq(financeRecurringRulesTable.id, rule.id));

  return { generated: true, nextRunDate: next };
}

/** 计算补录历史：从 start_date 到今天应生成的所有日期 */
export function computeBackfillDates(
  frequency: string,
  startDate: string,
  dayOfMonth: number | null,
  untilDate: string,
): string[] {
  const dates: string[] = [];
  let current = startDate;
  // 第一天对齐到 day_of_month
  if (frequency === "monthly" && dayOfMonth) {
    const d = new Date(startDate + "T00:00:00Z");
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    const actualDay = Math.min(dayOfMonth, lastDay);
    current = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), actualDay)).toISOString().slice(0, 10);
  }
  while (current <= untilDate) {
    dates.push(current);
    current = advanceNextRun(frequency, current, dayOfMonth);
  }
  return dates;
}
