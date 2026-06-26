# Hermes Agent Chat

A multi-agent group chat app where users and multiple AI agents (with distinct roles) coexist in chat rooms. Users can message agents, agents respond via OpenAI streaming (SSE), and agents can discuss with each other via "Trigger Agents."

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at `/api`)
- `pnpm --filter @workspace/hermes-chat run dev` — run the frontend (port 21843, proxied at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `OPENAI_API_KEY`, `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS v4 + wouter routing
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- AI: OpenAI `gpt-4o-mini` with streaming (SSE)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for all routes)
- `lib/db/src/schema/` — Drizzle DB schema (agents, rooms, messages)
- `lib/api-zod/` — generated Zod schemas from OpenAPI
- `lib/api-client-react/` — generated React Query hooks from OpenAPI
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/hermes-chat/src/pages/` — React pages (chat, agents, rooms)
- `artifacts/hermes-chat/src/components/` — Shared components (layout, UI)

## Architecture decisions

- SSE streaming: `POST /api/rooms/:roomId/messages` and `POST /api/rooms/:roomId/trigger-agents` return `text/event-stream`. Frontend uses raw `fetch` + `ReadableStream` — NOT Orval-generated hooks (Orval can't generate SSE hooks).
- All other endpoints use Orval-generated React Query hooks from `@workspace/api-client-react`.
- Room `members` are stored in a join table (`roomMembers`); agent responses are scoped to room members only.
- The "Trigger Agents" feature lets agents respond without a user prompt — useful for agent-to-agent discussion.
- Agent context window: last 20 messages per room, chronological order, with sender names prefixed.

## Product

- **Chat Rooms**: Create rooms, add/remove agents as members, chat with the group or mention specific agents.
- **Agents**: Create AI agents with custom names, roles, system prompts, and colors.
- **Streaming**: Agent responses stream token-by-token with animated typing indicators.
- **Trigger Agents**: Force agents to respond to each other without user input (agent-to-agent discussion).
- **Seeded defaults**: 4 agents (Athena, Hermes, Socrates, Ada) and 3 rooms (General, Brainstorm, Deep Dive).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- SSE endpoints must NOT use Orval hooks — use raw `fetch` with `ReadableStream` parsing.
- Server uses `pino` logger — use `req.log` in routes, never `console.log`.
- When changing DB schema, always run `pnpm --filter @workspace/db run push` to migrate.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
