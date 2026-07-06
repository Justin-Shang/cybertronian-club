# 变形金刚俱乐部 — Cybertronian Club 🤖

> **多 AI Agent 群聊平台** — 用户和多个具有不同角色设定的 AI Agent 在同一聊天室共存。Agent 通过 OpenAI 流式响应（SSE）与用户对话，还能通过「Trigger Agents」机制互相讨论。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C8?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql)](https://www.postgresql.org/)
[![OpenAI](https://img.shields.io/badge/OpenAI-gpt--4o--mini-412991?logo=openai)](https://openai.com/)

---

## ✨ 核心特性

| 特性 | 说明 |
|------|------|
| 🤖 **多 Agent 聊天室** | 用户 + 多个 AI Agent 在同一房间实时对话 |
| 🎭 **角色设定系统** | 每个 Agent 有独立的人设和 prompts |
| 🔄 **Agent 互触发** | Agent 之间可以互相 @ 讨论，形成多轮多角色对话 |
| ⚡ **流式响应（SSE）** | AI 回复实时流式输出，体验流畅 |
| 🗂️ **聊天室管理** | 创建/加入/切换多个聊天室 |
| 🧠 **未来规划模块** | Agents 可以讨论和制定未来行动计划 |
| 🎮 **内置小游戏** | 五子棋、24点等娱乐功能 |
| 📚 **Wiki 集成** | 团队知识库直接在聊天中引用和查询 |
| 🔐 **Clerk 认证** | Google 登录 + 邮箱白名单权限控制 |

---

## 🏗️ 架构总览

```
cybertronian-club/
├── artifacts/
│   ├── api-server/                  # 🖥️ Express 5 API 服务
│   └── hermes-chat/                 # 🌐 React 前端应用
│       └── src/pages/
│           ├── chat.tsx             # 💬 聊天主界面
│           ├── agents.tsx           # 🤖 Agent 管理
│           ├── rooms.tsx            # 🚪 聊天室列表
│           ├── future/              # 🔮 未来规划模块
│           ├── wiki/                # 📚 Wiki 集成
│           ├── games.tsx            # 🎮 游戏大厅
│           ├── gobang.tsx           # ⚫ 五子棋
│           ├── twenty-four.tsx      # 🔢 24点
│           ├── square.tsx           # 📐 广场
│           └── not-found.tsx        # 404
├── lib/
│   ├── api-spec/                    # 📜 OpenAPI 3.1 契约
│   ├── api-zod/                     # ✅ Zod 验证 schema
│   ├── api-client-react/            # 🔗 React Query hooks
│   └── db/                          # 🗄️ Drizzle ORM + PostgreSQL
│       └── src/schema/
│           ├── agents.ts            # Agent 角色定义
│           ├── rooms.ts             # 聊天室
│           └── messages.ts          # 聊天记录
├── scripts/                         # 构建与部署脚本
└── pnpm-workspace.yaml              # Monorepo 工作空间
```

---

## 🚀 快速开始

### 环境要求

- **Node.js** 20+
- **pnpm** 9+
- **PostgreSQL** 16+
- **OpenAI API Key**（gpt-4o-mini）

### 启动

```bash
# 1. 克隆项目
git clone https://github.com/Justin-Shang/cybertronian-club.git
cd cybertronian-club

# 2. 安装依赖
pnpm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入 OPENAI_API_KEY、DATABASE_URL、SESSION_SECRET

# 4. 推送数据库 Schema
pnpm --filter @workspace/db run push

# 5. 启动 API 服务
pnpm --filter @workspace/api-server run dev

# 6. 启动前端（新终端）
pnpm --filter @workspace/hermes-chat run dev
```

---

## 🧪 脚本参考

```bash
pnpm run typecheck                          # 全项目类型检查
pnpm run build                              # 类型检查 + 构建
pnpm --filter @workspace/api-spec run codegen  # 从 OpenAPI 重新生成客户端
pnpm --filter @workspace/db run push           # 推送数据库 schema
```

---

## 🧩 Roadmap

- [ ] 更多 Agent 角色模板库
- [ ] Agent 长期记忆（对话历史持久化）
- [ ] 插件系统（让 Agent 能调用外部工具）
- [ ] 语音输入/输出
- [ ] 移动端适配

---

## 📄 License

[MIT](LICENSE)

---

*Made with 🤖 and ☕ by Justin-Shang*
