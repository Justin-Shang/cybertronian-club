import { Router, type IRouter } from "express";
import { eq, and, or } from "drizzle-orm";
import { db, agentsTable, gameSessionsTable } from "@workspace/db";
import OpenAI from "openai";
import { getEngine } from "../services/game-engine";

const defaultOpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getClient(agent?: typeof agentsTable.$inferSelect): { client: OpenAI; model: string } {
  if (agent?.apiBaseUrl) {
    return {
      client: new OpenAI({ baseURL: agent.apiBaseUrl, apiKey: agent.bearerToken ?? "no-key" }),
      model: agent.modelName ?? "hermes-agent",
    };
  }
  return { client: defaultOpenAI, model: "gpt-4o-mini" };
}

const router: IRouter = Router();

// ─── Session CRUD ────────────────────────────────────────────────────────────

// Create a game session
router.post("/games/sessions", async (req, res): Promise<void> => {
  const { gameType, player1Type, player1Id, player2Type, player2Id } = req.body as {
    gameType: string;
    player1Type: string;
    player1Id?: number | null;
    player2Type: string;
    player2Id?: number | null;
  };

  if (!gameType || !player1Type || !player2Type) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const engine = getEngine(gameType);
  if (!engine) {
    res.status(400).json({ error: `Unknown game type: ${gameType}` });
    return;
  }

  const initialState = engine.initState();
  const isAgentVsAgent = player1Type === "agent" && player2Type === "agent";
  const initialStatus = "playing";

  const [session] = await db
    .insert(gameSessionsTable)
    .values({
      gameType,
      player1Type,
      player1Id: player1Id ?? null,
      player2Type,
      player2Id: player2Id ?? null,
      state: initialState,
      currentTurn: 1,
      status: initialStatus,
    })
    .returning();

  res.status(201).json(session);
});

// List user's game sessions
router.get("/games/sessions", async (_req, res): Promise<void> => {
  const sessions = await db
    .select()
    .from(gameSessionsTable)
    .orderBy(gameSessionsTable.updatedAt)
    .limit(50);
  res.json(sessions);
});

// Get session detail
router.get("/games/sessions/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const [session] = await db
    .select()
    .from(gameSessionsTable)
    .where(eq(gameSessionsTable.id, id));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Fetch agent names for display
  let player1Name = "You";
  let player2Name = "You";
  if (session.player1Id) {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, session.player1Id));
    if (agent) player1Name = agent.name;
  }
  if (session.player2Id) {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, session.player2Id));
    if (agent) player2Name = agent.name;
  }

  res.json({ ...session, player1Name, player2Name });
});

// Delete session
router.delete("/games/sessions/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }
  await db.delete(gameSessionsTable).where(eq(gameSessionsTable.id, id));
  res.sendStatus(204);
});

// ─── Submit a move (user or agent) ───────────────────────────────────────────

async function getAgentForPlayer(session: typeof gameSessionsTable.$inferSelect, player: 1 | 2) {
  const agentId = player === 1 ? session.player1Id : session.player2Id;
  if (!agentId) return undefined;
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  return agent;
}

async function doAgentMove(
  session: typeof gameSessionsTable.$inferSelect,
  engine: ReturnType<typeof getEngine>,
): Promise<typeof gameSessionsTable.$inferSelect | null> {
  if (!engine) return null;

  const agent = await getAgentForPlayer(session, session.currentTurn as 1 | 2);
  const agentName = agent?.name ?? `Player ${session.currentTurn}`;
  const { client, model } = getClient(agent);

  const state = session.state as Record<string, unknown>;
  const prompt = engine.buildPrompt(state, session.currentTurn as 1 | 2, agentName);

  try {
    // Try agent API with timeout, fallback to default OpenAI
    let completion;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      completion = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 20,
        temperature: 0.2,
      }, { signal: controller.signal });
      clearTimeout(timeout);
    } catch (agentErr) {
      console.warn(`[games] Agent API failed, falling back to default OpenAI: ${agentErr}`);
      completion = await defaultOpenAI.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 20,
        temperature: 0.2,
      });
    }

    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    const move = engine.parseResponse(text);

    if (!move) {
      console.error(`[games] Failed to parse agent response: "${text}"`);
      return null;
    }

    if (!engine.validateMove(state, move)) {
      // Find a fallback move
      const board = (state as { board: number[][] }).board;
      if (board) {
        for (let r = 0; r < board.length; r++) {
          for (let c = 0; c < board[r].length; c++) {
            if (board[r][c] === 0) {
              move.row = r;
              move.col = c;
              break;
            }
          }
          if (move.row !== undefined) break;
        }
      }
    }

    const result = engine.applyMove(state, move, session.currentTurn as 1 | 2);

    const [updated] = await db
      .update(gameSessionsTable)
      .set({
        state: result.state,
        currentTurn: session.currentTurn === 1 ? 2 : 1,
        status: result.over ? "finished" : "playing",
        winner: result.winner,
        updatedAt: new Date(),
      })
      .where(eq(gameSessionsTable.id, session.id))
      .returning();

    return updated ?? null;
  } catch (err) {
    console.error(`[games] Agent move error:`, err);
    return null;
  }
}

router.post("/games/sessions/:id/move", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const [session] = await db
    .select()
    .from(gameSessionsTable)
    .where(eq(gameSessionsTable.id, id));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.status === "finished") {
    res.status(400).json({ error: "Game already finished" });
    return;
  }

  const engine = getEngine(session.gameType);
  if (!engine) {
    res.status(400).json({ error: `Unknown game type: ${session.gameType}` });
    return;
  }

  const { move } = req.body as { move: Record<string, unknown> };
  const state = session.state as Record<string, unknown>;

  if (!engine.validateMove(state, move)) {
    res.status(400).json({ error: "Invalid move" });
    return;
  }

  // Apply the move
  const result = engine.applyMove(state, move, session.currentTurn as 1 | 2);

  const [updated] = await db
    .update(gameSessionsTable)
    .set({
      state: result.state,
      currentTurn: result.over ? session.currentTurn : (session.currentTurn === 1 ? 2 : 1),
      status: result.over ? "finished" : "playing",
      winner: result.winner,
      updatedAt: new Date(),
    })
    .where(eq(gameSessionsTable.id, id))
    .returning();

  if (!updated) {
    res.status(500).json({ error: "Failed to update session" });
    return;
  }

  // If game is not over and next turn is an agent, make the agent move
  let finalSession = updated;
  if (!result.over) {
    const nextPlayerType = updated.currentTurn === 1 ? updated.player1Type : updated.player2Type;
    if (nextPlayerType === "agent") {
      const agentResult = await doAgentMove(updated, engine);
      if (agentResult) {
        finalSession = agentResult;
      }
    }
  }

  res.json(finalSession);
});

// ─── Auto-play (Agent vs Agent) ──────────────────────────────────────────────

const autoPlayTimers = new Map<number, ReturnType<typeof setInterval>>();

router.post("/games/sessions/:id/auto-play", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const { action } = req.body as { action: "start" | "stop" };

  if (action === "stop") {
    const timer = autoPlayTimers.get(id);
    if (timer) {
      clearInterval(timer);
      autoPlayTimers.delete(id);
    }
    res.json({ message: "Auto-play stopped" });
    return;
  }

  // Start auto-play
  const [session] = await db
    .select()
    .from(gameSessionsTable)
    .where(eq(gameSessionsTable.id, id));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const engine = getEngine(session.gameType);
  if (!engine) {
    res.status(400).json({ error: `Unknown game type: ${session.gameType}` });
    return;
  }

  // Mark as playing
  await db
    .update(gameSessionsTable)
    .set({ status: "playing", updatedAt: new Date() })
    .where(eq(gameSessionsTable.id, id));

  // Clear existing timer
  const existing = autoPlayTimers.get(id);
  if (existing) clearInterval(existing);

  // Start auto-play loop
  const timer = setInterval(async () => {
    const [current] = await db
      .select()
      .from(gameSessionsTable)
      .where(eq(gameSessionsTable.id, id));

    if (!current || current.status === "finished") {
      clearInterval(timer);
      autoPlayTimers.delete(id);
      return;
    }

    const playerType = current.currentTurn === 1 ? current.player1Type : current.player2Type;
    if (playerType !== "agent") {
      // Not an agent's turn, stop auto-play
      clearInterval(timer);
      autoPlayTimers.delete(id);
      return;
    }

    const result = await doAgentMove(current, engine);
    if (!result || result.status === "finished") {
      clearInterval(timer);
      autoPlayTimers.delete(id);
    }
  }, 1500); // 1.5s between moves

  autoPlayTimers.set(id, timer);

  res.json({ message: "Auto-play started" });
});

// ─── Gobang (legacy direct endpoint) ─────────────────────────────────────────

function renderBoard(board: number[][]): string {
  const symbols = [" · ", " ● ", " ○ "];
  return board.map((row, r) =>
    row.map((cell) => symbols[cell]).join("") + `  ${r}`
  ).join("\n");
}

router.post("/games/gobang/move", async (req, res): Promise<void> => {
  const { board, agentId } = req.body as { board: number[][]; agentId?: number };

  if (!board || board.length !== 15 || board[0].length !== 15) {
    res.status(400).json({ error: "Invalid board" });
    return;
  }

  let agent: typeof agentsTable.$inferSelect | undefined;
  if (agentId) {
    const [row] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    agent = row;
  }

  const { client, model } = getClient(agent);
  const agentName = agent?.name ?? "AI";

  const boardStr = renderBoard(board);
  const colLabels = Array.from({ length: 15 }, (_, i) => String(i).padStart(2)).join(" ");

  const prompt = `You are playing Gobang (五子棋) as White (○). Your goal is to get 5 in a row (horizontally, vertically, or diagonally).

Rules:
- ● = Black (human player, plays first)
- ○ = White (you)
- · = empty

Board (row 0 is top, col 0 is left):
     col: ${colLabels}
${boardStr}

Important strategy:
1. If you have 4 in a row, complete it to win
2. If the human has 4 in a row, block it immediately
3. If you have 3 in a row open on both sides, extend it
4. If the human has 3 in a row open on both sides, block it
5. Otherwise, play near the center and build your position

Respond with ONLY the coordinates in the format "row,col" (0-indexed). Nothing else. Example: "7,7"`;

  try {
    // Try agent API with timeout, fallback to default OpenAI
    let completion;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      completion = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 20,
        temperature: 0.2,
      }, { signal: controller.signal });
      clearTimeout(timeout);
    } catch (agentErr) {
      console.warn(`[games] Agent API failed, falling back to default OpenAI: ${agentErr}`);
      completion = await defaultOpenAI.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 20,
        temperature: 0.2,
      });
    }

    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    const match = text.match(/(\d+)\s*[,，]\s*(\d+)/);
    if (!match) {
      res.status(500).json({ error: `Could not parse AI response: "${text}"` });
      return;
    }

    const row = parseInt(match[1]);
    const col = parseInt(match[2]);

    if (row < 0 || row >= 15 || col < 0 || col >= 15) {
      res.status(500).json({ error: "AI returned out-of-bounds move" });
      return;
    }
    if (board[row][col] !== 0) {
      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          if (board[r][c] === 0) {
            res.json({ row: r, col: c, fallback: true });
            return;
          }
        }
      }
      res.status(500).json({ error: "No empty cells" });
      return;
    }

    res.json({ row, col });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI error";
    res.status(500).json({ error: message });
  }
});

// ─── 24点 ─────────────────────────────────────────────────────────────────────

router.post("/games/twentyfour/hint", async (req, res): Promise<void> => {
  const { numbers, agentId } = req.body as { numbers: number[]; agentId?: number };

  if (!numbers || numbers.length !== 4) {
    res.status(400).json({ error: "Need exactly 4 numbers" });
    return;
  }

  let agent: typeof agentsTable.$inferSelect | undefined;
  if (agentId) {
    const [row] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    agent = row;
  }

  const { client, model } = getClient(agent);

  const prompt = `You are solving the 24 Points (24点) puzzle. You have these 4 numbers: ${numbers.join(", ")}.
Using each number exactly once and the operations +, -, *, / and parentheses, make the result equal to 24.

If a solution exists, respond with just the expression (e.g. "(8 - 2) * (6 - 2)").
If no solution exists, respond with exactly: "无解"

Only respond with the expression or "无解", nothing else.`;

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 60,
      temperature: 0,
    });

    const hint = completion.choices[0]?.message?.content?.trim() ?? "无解";
    res.json({ hint });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI error";
    res.status(500).json({ error: message });
  }
});

export default router;
