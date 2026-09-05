import { db, graphNodesTable, graphEdgesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { extractFacts } from "./llm";
import type { Logger } from "pino";

// P0-3 shared ingestion: turn free-text content into graph nodes/edges.
// Used by both the wiki POST /pages hook and the explicit POST /graphs/:id/ingest.
// Idempotent by metadata.contentHash.

export interface IngestInput {
  content: string;
  contentHash: string;
  source?: string;
  pageId?: number;
  generatedAt?: string; // ISO date or yyyy-mm-dd
}

export interface IngestResult {
  createdNodes: number;
  reusedNodes: number;
  createdEdges: number;
  skippedEdges: number;
  details: { nodes: number[]; edges: number[] };
}

async function getExistingLabels(graphId: number): Promise<string[]> {
  const rows = await db
    .select({ label: graphNodesTable.label })
    .from(graphNodesTable)
    .where(eq(graphNodesTable.graphId, graphId));
  return rows.map((r) => r.label);
}

// Find an existing node by label (case-insensitive, trimmed). Returns node id or null.
async function findNodeByLabel(graphId: number, label: string): Promise<number | null> {
  const [row] = await db
    .select({ id: graphNodesTable.id })
    .from(graphNodesTable)
    .where(and(eq(graphNodesTable.graphId, graphId), sql`lower(${graphNodesTable.label}) = lower(${label})`))
    .limit(1);
  return row?.id ?? null;
}

// Check idempotency: a node whose metadata.contentHash matches.
async function findExistingIngestNode(
  graphId: number,
  contentHash: string,
): Promise<{ id: number } | null> {
  const [row] = await db
    .select({ id: graphNodesTable.id })
    .from(graphNodesTable)
    .where(
      and(
        eq(graphNodesTable.graphId, graphId),
        sql`${graphNodesTable.metadata}->>'contentHash' = ${contentHash}`,
      ),
    )
    .limit(1);
  return row ? { id: row.id } : null;
}

// Check edge dedup: same (graph, source, target, edgeType) already exists.
async function edgeExists(
  graphId: number,
  sourceNodeId: number,
  targetNodeId: number,
  edgeType: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: graphEdgesTable.id })
    .from(graphEdgesTable)
    .where(
      and(
        eq(graphEdgesTable.graphId, graphId),
        eq(graphEdgesTable.sourceNodeId, sourceNodeId),
        eq(graphEdgesTable.targetNodeId, targetNodeId),
        eq(graphEdgesTable.edgeType, edgeType),
      ),
    )
    .limit(1);
  return !!row;
}

export async function ingestContent(
  graphId: number,
  input: IngestInput,
  log?: Logger,
): Promise<IngestResult> {
  const result: IngestResult = { createdNodes: 0, reusedNodes: 0, createdEdges: 0, skippedEdges: 0, details: { nodes: [], edges: [] } };

  if (!input.content || !input.contentHash) {
    return result;
  }

  // 1) Idempotency check
  const existing = await findExistingIngestNode(graphId, input.contentHash);
  if (existing) {
    result.reusedNodes = 1;
    log?.info({ graphId, contentHash: input.contentHash, nodeId: existing.id }, "ingest skipped (idempotent)");
    return result;
  }

  // 2) Extract facts via LLM
  const existingLabels = await getExistingLabels(graphId);
  const facts = await extractFacts(input.content, existingLabels, log);
  if (facts.nodes.length === 0 && facts.edges.length === 0) {
    log?.info({ graphId }, "ingest extracted no facts");
    return result;
  }

  // 3) Create/reuse nodes — build label→id map
  const labelToId = new Map<string, number>();
  // seed with all existing labels (lowercased) for edge resolution
  for (const label of existingLabels) {
    const id = await findNodeByLabel(graphId, label);
    if (id) labelToId.set(label.toLowerCase(), id);
  }

  const sourceDate = input.generatedAt || new Date().toISOString().slice(0, 10);
  for (const factNode of facts.nodes) {
    const key = factNode.label.toLowerCase();
    const existingId = labelToId.get(key);
    if (existingId) {
      result.reusedNodes += 1;
      result.details.nodes.push(existingId);
      continue;
    }
    const [node] = await db
      .insert(graphNodesTable)
      .values({
        graphId,
        label: factNode.label,
        type: factNode.type || "concept",
        content: factNode.content || "",
        pageId: input.pageId ?? null,
        sourceDate,
        metadata: { contentHash: input.contentHash, source: input.source ?? null },
      })
      .returning();
    labelToId.set(key, node.id);
    result.createdNodes += 1;
    result.details.nodes.push(node.id);
  }

  // 4) Create edges (dedup by source/target/edgeType)
  for (const factEdge of facts.edges) {
    const fromId = labelToId.get(factEdge.fromLabel.toLowerCase());
    const toId = labelToId.get(factEdge.toLabel.toLowerCase());
    if (!fromId || !toId) {
      result.skippedEdges += 1;
      continue;
    }
    if (fromId === toId) {
      result.skippedEdges += 1;
      continue;
    }
    if (await edgeExists(graphId, fromId, toId, factEdge.edgeType)) {
      result.skippedEdges += 1;
      continue;
    }
    const [edge] = await db
      .insert(graphEdgesTable)
      .values({
        graphId,
        sourceNodeId: fromId,
        targetNodeId: toId,
        label: factEdge.edgeType,
        edgeType: factEdge.edgeType,
        style: factEdge.edgeType === "其他" ? "dashed" : "solid",
      })
      .returning();
    result.createdEdges += 1;
    result.details.edges.push(edge.id);
  }

  // 5) If no new fact-node was created (all reused, or no facts extracted),
  //    record a lightweight marker node so the contentHash is remembered as
  //    ingested (prevents re-extraction next time). When createdNodes > 0 the
  //    new nodes already carry the contentHash in metadata, so no marker needed.
  if (result.createdNodes === 0) {
    const [marker] = await db
      .insert(graphNodesTable)
      .values({
        graphId,
        label: input.source ? `${input.source} 归档` : "归档内容",
        type: "document",
        content: input.content.slice(0, 200),
        pageId: input.pageId ?? null,
        sourceDate,
        metadata: { contentHash: input.contentHash, source: input.source ?? null, isArchiveMarker: true },
      })
      .returning();
    result.createdNodes = 1;
    result.details.nodes.push(marker.id);
  }

  log?.info({ graphId, ...result }, "ingest completed");
  return result;
}
