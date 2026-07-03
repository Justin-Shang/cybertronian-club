import { db, pagesTable, auditLogsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const SOURCE_API = "https://agent-wiki.replit.app";
const API_KEY = process.env.SOURCE_API_KEY!;

async function fetchAll<T>(path: string): Promise<T[]> {
  const res = await fetch(`${SOURCE_API}${path}`, {
    headers: { "x-api-key": API_KEY },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

type RemotePage = {
  id: number;
  parentId: number | null;
  title: string;
  content: string;
  category: "communication" | "skill" | "document";
  author: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

type RemoteAudit = {
  id: number;
  actor: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  pageId: number;
  pageTitle: string;
  details: string | null;
  createdAt: string;
};

async function main() {
  if (!API_KEY) {
    console.error("SOURCE_API_KEY env var is required");
    process.exit(1);
  }

  console.log("Fetching pages from source API…");
  const pages: RemotePage[] = await fetchAll("/api/pages");
  console.log(`  Got ${pages.length} pages`);

  console.log("Fetching audit logs from source API…");
  const audits: RemoteAudit[] = await fetchAll("/api/audit?limit=5000");
  console.log(`  Got ${audits.length} audit logs`);

  // --- Pages ---
  // Sort by id ascending so parents are inserted before children
  pages.sort((a, b) => a.id - b.id);

  console.log("Inserting pages (upsert by id)…");
  let pageOk = 0, pageSkip = 0;
  for (const p of pages) {
    try {
      await db
        .insert(pagesTable)
        .values({
          id: p.id,
          parentId: p.parentId ?? null,
          title: p.title,
          content: p.content,
          category: p.category,
          author: p.author,
          tags: p.tags ?? [],
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        })
        .onConflictDoUpdate({
          target: pagesTable.id,
          set: {
            parentId: p.parentId ?? null,
            title: p.title,
            content: p.content,
            category: p.category,
            author: p.author,
            tags: p.tags ?? [],
            updatedAt: new Date(p.updatedAt),
          },
        });
      pageOk++;
    } catch (err) {
      console.warn(`  Page id=${p.id} skipped:`, err);
      pageSkip++;
    }
  }
  console.log(`  Pages done: ${pageOk} upserted, ${pageSkip} skipped`);

  // Sync the id sequence so future auto-increments start after the max imported id
  const maxPageId = Math.max(...pages.map((p) => p.id));
  await db.execute(
    sql`SELECT setval(pg_get_serial_sequence('pages', 'id'), ${maxPageId}, true)`,
  );
  console.log(`  Sequence reset to ${maxPageId}`);

  // --- Audit Logs ---
  audits.sort((a, b) => a.id - b.id);

  console.log("Inserting audit logs (upsert by id)…");
  let auditOk = 0, auditSkip = 0;
  for (const a of audits) {
    try {
      await db
        .insert(auditLogsTable)
        .values({
          id: a.id,
          actor: a.actor,
          action: a.action,
          pageId: a.pageId,
          pageTitle: a.pageTitle,
          details: a.details ?? null,
          createdAt: new Date(a.createdAt),
        })
        .onConflictDoUpdate({
          target: auditLogsTable.id,
          set: {
            actor: a.actor,
            action: a.action,
            pageId: a.pageId,
            pageTitle: a.pageTitle,
            details: a.details ?? null,
          },
        });
      auditOk++;
    } catch (err) {
      console.warn(`  Audit id=${a.id} skipped:`, err);
      auditSkip++;
    }
  }
  console.log(`  Audit logs done: ${auditOk} upserted, ${auditSkip} skipped`);

  const maxAuditId = Math.max(...audits.map((a) => a.id));
  await db.execute(
    sql`SELECT setval(pg_get_serial_sequence('audit_logs', 'id'), ${maxAuditId}, true)`,
  );
  console.log(`  Audit sequence reset to ${maxAuditId}`);

  console.log("\n✅ Migration complete!");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
