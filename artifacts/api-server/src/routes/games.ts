import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import OpenAI from "openai";

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

// ─── Gobang (五子棋) ──────────────────────────────────────────────────────────

// Render board as ASCII for the LLM prompt
function renderBoard(board: number[][]): string {
  const symbols = [" · ", " ● ", " ○ "];
  return board.map((row, r) =>
    row.map((cell, c) => {
      const label = symbols[cell];
      return label;
    }).join("") + `  ${r}`
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
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 20,
      temperature: 0.2,
    });

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
      // Cell already occupied — find nearest empty cell
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
