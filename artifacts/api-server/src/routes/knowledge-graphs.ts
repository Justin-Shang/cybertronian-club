import { Router } from "express";
import { db, knowledgeGraphsTable, graphNodesTable, graphEdgesTable, EDGE_TYPES } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { extractEntities, generateAnswer, tavilySearch, synthesizeAnswer } from "../lib/llm";
import { ingestContent } from "../lib/graph-ingest";

const router = Router();

const VALID_EDGE_TYPE_SET = new Set(EDGE_TYPES);

// Map a free-text edge label to an edge type when edgeType is omitted.
function inferEdgeType(label: string): string {
  const l = label.trim();
  if (!l) return "其他";
  if (/属于|包含|分类|是一种|是/.test(l)) return "属于";
  if (/先修|前置|依赖|基础|前提/.test(l)) return "先修";
  if (/矛盾|对立|冲突|相反/.test(l)) return "矛盾";
  if (/替代|备选|代替|取代/.test(l)) return "替代";
  if (/应用|用于|适用|场景/.test(l)) return "应用于";
  if (/信号|来源|参考|引用|出自/.test(l)) return "信号来源";
  if (/配合|协同|组合|搭配|一起/.test(l)) return "配合";
  return "其他";
}

// ──────────────── Knowledge Graphs CRUD ────────────────

// GET /graphs
router.get("/graphs", async (_req, res) => {
  try {
    const graphs = await db
      .select()
      .from(knowledgeGraphsTable)
      .orderBy(desc(knowledgeGraphsTable.updatedAt));
    res.json(graphs);
  } catch (err) {
    _req.log.error({ err }, "Failed to list graphs");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /graphs
router.post("/graphs", async (req, res) => {
  try {
    const { name, description, type, ownerAgent } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    const [graph] = await db
      .insert(knowledgeGraphsTable)
      .values({
        name: name.trim(),
        description: description ?? "",
        type: type ?? "knowledge",
        ownerAgent: ownerAgent ?? null,
      })
      .returning();
    res.status(201).json(graph);
  } catch (err) {
    req.log.error({ err }, "Failed to create graph");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /graphs/:id — returns graph with all nodes and edges
router.get("/graphs/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }

    const [graph] = await db
      .select()
      .from(knowledgeGraphsTable)
      .where(eq(knowledgeGraphsTable.id, id));
    if (!graph) { res.status(404).json({ error: "Graph not found" }); return; }

    const nodes = await db
      .select()
      .from(graphNodesTable)
      .where(eq(graphNodesTable.graphId, id))
      .orderBy(graphNodesTable.label);

    const edges = await db
      .select()
      .from(graphEdgesTable)
      .where(eq(graphEdgesTable.graphId, id))
      .orderBy(graphEdgesTable.id);

    res.json({ ...graph, nodes, edges });
  } catch (err) {
    req.log.error({ err }, "Failed to get graph");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /graphs/:id
router.put("/graphs/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }

    const { name, description, type, ownerAgent } = req.body;
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (type !== undefined) updateData.type = type;
    if (ownerAgent !== undefined) updateData.ownerAgent = ownerAgent;

    const [graph] = await db
      .update(knowledgeGraphsTable)
      .set(updateData)
      .where(eq(knowledgeGraphsTable.id, id))
      .returning();
    if (!graph) { res.status(404).json({ error: "Graph not found" }); return; }
    res.json(graph);
  } catch (err) {
    req.log.error({ err }, "Failed to update graph");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /graphs/:id
router.delete("/graphs/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
    const [existing] = await db.select().from(knowledgeGraphsTable).where(eq(knowledgeGraphsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Graph not found" }); return; }
    await db.delete(knowledgeGraphsTable).where(eq(knowledgeGraphsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete graph");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────── Nodes CRUD ────────────────

// POST /graphs/:id/nodes
router.post("/graphs/:id/nodes", async (req, res) => {
  try {
    const graphId = parseInt(req.params.id, 10);
    if (isNaN(graphId) || graphId <= 0) { res.status(400).json({ error: "Invalid graph id" }); return; }

    const { label, type, content, color, metadata, pageId, sourceDate, externalGraphId, externalNodeId } = req.body;
    if (!label || typeof label !== "string" || !label.trim()) {
      res.status(400).json({ error: "Label is required" });
      return;
    }

    const [node] = await db
      .insert(graphNodesTable)
      .values({
        graphId,
        label: label.trim(),
        type: type ?? "concept",
        content: content ?? "",
        color: color ?? null,
        metadata: metadata ?? {},
        pageId: pageId ?? null,
        sourceDate: sourceDate ?? null,
        externalGraphId: externalGraphId ?? null,
        externalNodeId: externalNodeId ?? null,
      })
      .returning();
    res.status(201).json(node);
  } catch (err) {
    req.log.error({ err }, "Failed to create node");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT/PATCH /graphs/:id/nodes/:nodeId  (PATCH alias matches wiki-pages convention)
async function updateNodeHandler(req: import("express").Request, res: import("express").Response) {
  try {
    const nodeId = parseInt(req.params.nodeId, 10);
    if (isNaN(nodeId) || nodeId <= 0) { res.status(400).json({ error: "Invalid node id" }); return; }

    const { label, type, content, color, metadata, pageId, sourceDate, externalGraphId, externalNodeId } = req.body;
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (label !== undefined) updateData.label = label;
    if (type !== undefined) updateData.type = type;
    if (content !== undefined) updateData.content = content;
    if (color !== undefined) updateData.color = color;
    if (metadata !== undefined) updateData.metadata = metadata;
    if (pageId !== undefined) updateData.pageId = pageId;
    if (sourceDate !== undefined) updateData.sourceDate = sourceDate;
    if (externalGraphId !== undefined) updateData.externalGraphId = externalGraphId;
    if (externalNodeId !== undefined) updateData.externalNodeId = externalNodeId;

    const [node] = await db
      .update(graphNodesTable)
      .set(updateData)
      .where(eq(graphNodesTable.id, nodeId))
      .returning();
    if (!node) { res.status(404).json({ error: "Node not found" }); return; }
    res.json(node);
  } catch (err) {
    req.log.error({ err }, "Failed to update node");
    res.status(500).json({ error: "Internal server error" });
  }
}
router.put("/graphs/:id/nodes/:nodeId", updateNodeHandler);
router.patch("/graphs/:id/nodes/:nodeId", updateNodeHandler);

// DELETE /graphs/:id/nodes/:nodeId
router.delete("/graphs/:id/nodes/:nodeId", async (req, res) => {
  try {
    const nodeId = parseInt(req.params.nodeId, 10);
    if (isNaN(nodeId) || nodeId <= 0) { res.status(400).json({ error: "Invalid node id" }); return; }
    await db.delete(graphNodesTable).where(eq(graphNodesTable.id, nodeId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete node");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────── Edges CRUD ────────────────

// POST /graphs/:id/edges
router.post("/graphs/:id/edges", async (req, res) => {
  try {
    const graphId = parseInt(req.params.id, 10);
    if (isNaN(graphId) || graphId <= 0) { res.status(400).json({ error: "Invalid graph id" }); return; }

    const { sourceNodeId, targetNodeId, label, color, style, edgeType, metadata } = req.body;
    if (!sourceNodeId || !targetNodeId) {
      res.status(400).json({ error: "sourceNodeId and targetNodeId are required" });
      return;
    }

    // Validate / infer edgeType
    let resolvedEdgeType = edgeType;
    if (resolvedEdgeType !== undefined && resolvedEdgeType !== null) {
      if (!VALID_EDGE_TYPE_SET.has(resolvedEdgeType)) {
        res.status(400).json({ error: `edgeType must be one of: ${EDGE_TYPES.join(", ")}` });
        return;
      }
    } else {
      resolvedEdgeType = inferEdgeType(label ?? "");
    }

    const [edge] = await db
      .insert(graphEdgesTable)
      .values({
        graphId,
        sourceNodeId,
        targetNodeId,
        label: label ?? resolvedEdgeType ?? "",
        color: color ?? null,
        style: style ?? (resolvedEdgeType === "其他" ? "dashed" : "solid"),
        edgeType: resolvedEdgeType,
        metadata: metadata ?? {},
      })
      .returning();
    res.status(201).json(edge);
  } catch (err) {
    req.log.error({ err }, "Failed to create edge");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT/PATCH /graphs/:id/edges/:edgeId
async function updateEdgeHandler(req: import("express").Request, res: import("express").Response) {
  try {
    const edgeId = parseInt(req.params.edgeId, 10);
    if (isNaN(edgeId) || edgeId <= 0) { res.status(400).json({ error: "Invalid edge id" }); return; }

    const { label, color, style, edgeType, metadata } = req.body;
    if (edgeType !== undefined && edgeType !== null && !VALID_EDGE_TYPE_SET.has(edgeType)) {
      res.status(400).json({ error: `edgeType must be one of: ${EDGE_TYPES.join(", ")}` });
      return;
    }
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (label !== undefined) updateData.label = label;
    if (color !== undefined) updateData.color = color;
    if (style !== undefined) updateData.style = style;
    if (edgeType !== undefined) updateData.edgeType = edgeType;
    if (metadata !== undefined) updateData.metadata = metadata;

    const [edge] = await db
      .update(graphEdgesTable)
      .set(updateData)
      .where(eq(graphEdgesTable.id, edgeId))
      .returning();
    if (!edge) { res.status(404).json({ error: "Edge not found" }); return; }
    res.json(edge);
  } catch (err) {
    req.log.error({ err }, "Failed to update edge");
    res.status(500).json({ error: "Internal server error" });
  }
}
router.put("/graphs/:id/edges/:edgeId", updateEdgeHandler);
router.patch("/graphs/:id/edges/:edgeId", updateEdgeHandler);

// DELETE /graphs/:id/edges/:edgeId
router.delete("/graphs/:id/edges/:edgeId", async (req, res) => {
  try {
    const edgeId = parseInt(req.params.edgeId, 10);
    if (isNaN(edgeId) || edgeId <= 0) { res.status(400).json({ error: "Invalid edge id" }); return; }
    await db.delete(graphEdgesTable).where(eq(graphEdgesTable.id, edgeId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete edge");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────── P0-3: Ingest ────────────────

// POST /graphs/:id/ingest — explicit ingest endpoint (also used by wiki hook via shared lib)
router.post("/graphs/:id/ingest", async (req, res) => {
  try {
    const graphId = parseInt(req.params.id, 10);
    if (isNaN(graphId) || graphId <= 0) { res.status(400).json({ error: "Invalid graph id" }); return; }

    const { content, contentHash, source, pageId, generatedAt } = req.body;
    if (!content || !contentHash) {
      res.status(400).json({ error: "content and contentHash are required" });
      return;
    }

    const result = await ingestContent(graphId, { content, contentHash, source, pageId, generatedAt }, req.log);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to ingest graph");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────── P0-2: Graph QA (lightweight GraphRAG) ────────────────

// GET /graphs/:id/qa?q=...
router.get("/graphs/:id/qa", async (req, res) => {
  try {
    const graphId = parseInt(req.params.id, 10);
    if (isNaN(graphId) || graphId <= 0) { res.status(400).json({ error: "Invalid graph id" }); return; }
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) { res.status(400).json({ error: "Query parameter q is required" }); return; }

    const [graph] = await db.select().from(knowledgeGraphsTable).where(eq(knowledgeGraphsTable.id, graphId));
    if (!graph) { res.status(404).json({ error: "Graph not found" }); return; }

    const nodes = await db.select().from(graphNodesTable).where(eq(graphNodesTable.graphId, graphId));
    const edges = await db.select().from(graphEdgesTable).where(eq(graphEdgesTable.graphId, graphId));

    if (nodes.length === 0) {
      res.json({ answer: "该图谱暂无节点，无法回答。", citedNodes: [], sources: [] });
      return;
    }

    // 1) Extract entities from question
    const entities = await extractEntities(q, req.log);

    // 2) Match nodes by label (contains, case-insensitive)
    const matchedNodes = new Set<number>();
    const entityPool = entities.length > 0 ? entities : [q];
    for (const node of nodes) {
      const labelLower = node.label.toLowerCase();
      for (const e of entityPool) {
        const eLower = e.toLowerCase();
        if (labelLower.includes(eLower) || eLower.includes(labelLower)) {
          matchedNodes.add(node.id);
          break;
        }
      }
    }
    // Fallback: if no match, seed with highest-degree node so QA still returns something
    if (matchedNodes.size === 0) {
      const deg = computeDegrees(nodes, edges);
      const top = [...deg.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) matchedNodes.add(top[0]);
    }

    // 3) BFS 2-hop neighborhood
    const neighborhood = bfsNeighborhood(matchedNodes, edges, 2);
    const neighNodeIds = new Set(neighborhood.nodes);
    const neighNodes = nodes.filter((n) => neighNodeIds.has(n.id));
    const neighEdges = edges.filter((e) => neighNodeIds.has(e.sourceNodeId) && neighNodeIds.has(e.targetNodeId));

    // 4) Build context
    const nodeLines = neighNodes
      .map((n) => `[${n.id}] ${n.label} (${n.type}): ${n.content || "(无描述)"}`)
      .join("\n");
    const edgeLines = neighEdges
      .map((e) => {
        const from = nodes.find((n) => n.id === e.sourceNodeId)?.label ?? "?";
        const to = nodes.find((n) => n.id === e.targetNodeId)?.label ?? "?";
        return `${from} --[${e.edgeType || e.label || "关联"}]--> ${to}`;
      })
      .join("\n");
    const context = `Nodes:\n${nodeLines}\n\nEdges:\n${edgeLines}`;

    // 5) Generate answer from graph context (with sufficiency flag)
    const citedCandidates = neighNodes.map((n) => ({ id: n.id, label: n.label }));
    const graphResult = await generateAnswer(q, context, citedCandidates, req.log);

    let answer = graphResult.answer;
    let citedNodeIds = graphResult.citedNodeIds;
    let sources: { title: string; url: string }[] = [];

    // 6) If graph context insufficient, augment with Tavily web search + LLM synthesis
    if (!graphResult.sufficient) {
      req.log.info({ graphId, q }, "graph context insufficient, triggering web search");
      const search = await tavilySearch(q, 5, req.log);
      if (search.results.length > 0) {
        const synth = await synthesizeAnswer(q, context, search.results, citedCandidates, req.log);
        answer = synth.answer;
        citedNodeIds = synth.citedNodeIds;
        sources = search.results.map((r) => ({ title: r.title, url: r.url }));
      }
    }

    // 7) Resolve cited nodes (fallback to matched if LLM returned none)
    const finalCitedIds = citedNodeIds.length > 0 ? citedNodeIds : [...matchedNodes];
    const citedNodes = finalCitedIds
      .map((id) => {
        const n = nodes.find((x) => x.id === id);
        return n ? { id: n.id, label: n.label, pageId: n.pageId } : null;
      })
      .filter((x): x is { id: number; label: string; pageId: number | null } => x !== null);

    res.json({ answer, citedNodes, sources });
  } catch (err) {
    req.log.error({ err }, "Failed to answer graph QA");
    res.status(200).json({ answer: "问答服务暂不可用。", citedNodes: [], sources: [] });
  }
});

// ──────────────── P1: Analysis endpoints ────────────────

// P1-4 / P0-2 helper: GET /graphs/:id/neighbors/:nodeId?depth=2
router.get("/graphs/:id/neighbors/:nodeId", async (req, res) => {
  try {
    const graphId = parseInt(req.params.id, 10);
    const nodeId = parseInt(req.params.nodeId, 10);
    if (isNaN(graphId) || graphId <= 0 || isNaN(nodeId) || nodeId <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const depthRaw = parseInt(String(req.query.depth ?? "2"), 10);
    const depth = isNaN(depthRaw) || depthRaw < 1 ? 2 : Math.min(depthRaw, 5);

    const edges = await db.select().from(graphEdgesTable).where(eq(graphEdgesTable.graphId, graphId));
    const result = bfsNeighborhood(new Set([nodeId]), edges, depth);
    const nodeIds = new Set(result.nodes);
    const nodes = await db
      .select()
      .from(graphNodesTable)
      .where(eq(graphNodesTable.graphId, graphId));
    res.json({
      nodes: nodes.filter((n) => nodeIds.has(n.id)),
      edges: result.edges.map((eid) => edges.find((e) => e.id === eid)).filter(Boolean),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get neighbors");
    res.status(500).json({ error: "Internal server error" });
  }
});

// P1-2: GET /graphs/:id/path?from=&to=
router.get("/graphs/:id/path", async (req, res) => {
  try {
    const graphId = parseInt(req.params.id, 10);
    if (isNaN(graphId) || graphId <= 0) { res.status(400).json({ error: "Invalid graph id" }); return; }
    const from = parseInt(String(req.query.from ?? ""), 10);
    const to = parseInt(String(req.query.to ?? ""), 10);
    if (isNaN(from) || isNaN(to) || from <= 0 || to <= 0) {
      res.status(400).json({ error: "from and to query params are required" });
      return;
    }

    const edges = await db.select().from(graphEdgesTable).where(eq(graphEdgesTable.graphId, graphId));
    // BFS shortest path (treat edges as undirected for discovery)
    const adj = new Map<number, number[]>();
    for (const e of edges) {
      if (!adj.has(e.sourceNodeId)) adj.set(e.sourceNodeId, []);
      if (!adj.has(e.targetNodeId)) adj.set(e.targetNodeId, []);
      adj.get(e.sourceNodeId)!.push(e.targetNodeId);
      adj.get(e.targetNodeId)!.push(e.sourceNodeId);
    }

    const prev = new Map<number, number | null>();
    const visited = new Set<number>([from]);
    const queue: number[] = [from];
    prev.set(from, null);
    let found = false;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === to) { found = true; break; }
      for (const next of adj.get(cur) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          prev.set(next, cur);
          queue.push(next);
        }
      }
    }

    if (!found) { res.json({ path: [], edges: [] }); return; }

    // Reconstruct path
    const path: number[] = [];
    let cur: number | null = to;
    while (cur !== null) {
      path.unshift(cur);
      cur = prev.get(cur) ?? null;
    }

    // Resolve edges along the path
    const pathEdges: number[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const edge = edges.find((e) =>
        (e.sourceNodeId === a && e.targetNodeId === b) ||
        (e.sourceNodeId === b && e.targetNodeId === a),
      );
      if (edge) pathEdges.push(edge.id);
    }
    res.json({ path, edges: pathEdges });
  } catch (err) {
    req.log.error({ err }, "Failed to find path");
    res.status(500).json({ error: "Internal server error" });
  }
});

// P1-3: GET /graphs/:id/analysis/centrality
router.get("/graphs/:id/analysis/centrality", async (req, res) => {
  try {
    const graphId = parseInt(req.params.id, 10);
    if (isNaN(graphId) || graphId <= 0) { res.status(400).json({ error: "Invalid graph id" }); return; }

    const edges = await db.select().from(graphEdgesTable).where(eq(graphEdgesTable.graphId, graphId));
    const degreeMap = new Map<number, { inDegree: number; outDegree: number }>();
    for (const edge of edges) {
      const s = degreeMap.get(edge.sourceNodeId) ?? { inDegree: 0, outDegree: 0 };
      s.outDegree += 1;
      degreeMap.set(edge.sourceNodeId, s);
      const t = degreeMap.get(edge.targetNodeId) ?? { inDegree: 0, outDegree: 0 };
      t.inDegree += 1;
      degreeMap.set(edge.targetNodeId, t);
    }

    const ranked = [...degreeMap.entries()]
      .map(([nodeId, d]) => ({ nodeId, ...d, degree: d.inDegree + d.outDegree }))
      .sort((a, b) => b.degree - a.degree);

    const maxDegree = ranked[0]?.degree ?? 0;
    const nodes = ranked.map((n, i) => ({
      ...n,
      rank: i + 1,
      isHub: i < 5 && n.degree >= maxDegree * 0.6 && n.degree > 0,
    }));

    res.json({ nodes, maxDegree });
  } catch (err) {
    req.log.error({ err }, "Failed to compute centrality");
    res.status(500).json({ error: "Internal server error" });
  }
});

// P1-1: GET /graphs/:id/analysis/coverage
router.get("/graphs/:id/analysis/coverage", async (req, res) => {
  try {
    const graphId = parseInt(req.params.id, 10);
    if (isNaN(graphId) || graphId <= 0) { res.status(400).json({ error: "Invalid graph id" }); return; }

    const nodes = await db.select().from(graphNodesTable).where(eq(graphNodesTable.graphId, graphId));
    const edges = await db.select().from(graphEdgesTable).where(eq(graphEdgesTable.graphId, graphId));

    // concept nodes with metadata.expectedSubtopics
    const concepts = nodes.filter((n) => n.type === "concept" || n.type === "hub");
    const result = concepts
      .map((c) => {
        const meta = (c.metadata ?? {}) as Record<string, unknown>;
        // Accept both expectedSubtopics (canonical) and expectedChildren (alias)
        const expectedRaw: unknown = meta.expectedSubtopics ?? meta.expectedChildren;
        const expected: string[] = Array.isArray(expectedRaw)
          ? expectedRaw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
          : [];
        if (expected.length === 0) return null;

        // Find child nodes connected to this concept via "属于" edges (or any edge)
        const childNodeIds = new Set<number>();
        for (const e of edges) {
          if (e.targetNodeId === c.id) childNodeIds.add(e.sourceNodeId);
          if (e.sourceNodeId === c.id) childNodeIds.add(e.targetNodeId);
        }
        const childLabels = nodes
          .filter((n) => childNodeIds.has(n.id))
          .map((n) => n.label.toLowerCase());

        const covered: string[] = [];
        const missing: string[] = [];
        for (const exp of expected) {
          const expLower = exp.toLowerCase();
          const isCovered = childLabels.some((cl) => cl.includes(expLower) || expLower.includes(cl));
          if (isCovered) covered.push(exp);
          else missing.push(exp);
        }
        return {
          nodeId: c.id,
          label: c.label,
          expected,
          covered,
          missing,
          coverageRatio: expected.length > 0 ? covered.length / expected.length : 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    res.json({ concepts: result });
  } catch (err) {
    req.log.error({ err }, "Failed to compute coverage");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────── Graph helpers ────────────────

type AnyNode = typeof graphNodesTable.$inferSelect;
type AnyEdge = typeof graphEdgesTable.$inferSelect;

function computeDegrees(nodes: AnyNode[], edges: AnyEdge[]): Map<number, number> {
  const deg = new Map<number, number>();
  for (const n of nodes) deg.set(n.id, 0);
  for (const e of edges) {
    deg.set(e.sourceNodeId, (deg.get(e.sourceNodeId) ?? 0) + 1);
    deg.set(e.targetNodeId, (deg.get(e.targetNodeId) ?? 0) + 1);
  }
  return deg;
}

// BFS neighborhood expansion. Returns node ids and edge ids in the neighborhood.
function bfsNeighborhood(seeds: Set<number>, edges: AnyEdge[], maxDepth: number): { nodes: number[]; edges: number[] } {
  const visited = new Set<number>(seeds);
  const edgeIds: number[] = [];
  let frontier = [...seeds];
  for (let depth = 0; depth < maxDepth; depth++) {
    if (frontier.length === 0) break;
    const next: number[] = [];
    for (const cur of frontier) {
      for (const e of edges) {
        if (e.sourceNodeId === cur || e.targetNodeId === cur) {
          edgeIds.push(e.id);
          const other = e.sourceNodeId === cur ? e.targetNodeId : e.sourceNodeId;
          if (!visited.has(other)) {
            visited.add(other);
            next.push(other);
          }
        }
      }
    }
    frontier = next;
  }
  return { nodes: [...visited], edges: [...new Set(edgeIds)] };
}

export default router;
