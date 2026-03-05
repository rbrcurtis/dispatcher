# Conductor

Personal kanban board + Claude Code orchestration app.

## Tech Stack

- **Frontend:** React Router 7 (full-stack/SSR mode)
- **API:** tRPC (type-safe RPC, subscriptions for streaming Claude output)
- **Database:** SQLite via Drizzle ORM (better-sqlite3)
- **Styling:** Tailwind CSS
- **Hosting:** LAN-only, bound to 192.168.4.200, no auth (trusted network via OpenVPN)

## Code Style

- TypeScript strict mode
- Never use `any` — use `unknown` and narrow
- No barrel exports (index.ts re-exports)
- Direct, simple code — no unnecessary abstractions
- Early returns, guard clauses, no deep nesting
- Short variable names in local scope (`e`, `el`, `ctx`, `req`, `res`, `err`)
- Use `arg` library for any CLI scripts, parse args at top then `main()`

## Project Structure

```
src/
  server/           # tRPC routers, Claude Code subprocess manager, DB
    routers/        # tRPC router definitions
    claude/         # Claude Code subprocess spawn, protocol, streaming
    db/             # Drizzle schema, migrations, queries
    trpc.ts         # tRPC init, context
  app/
    routes/         # React Router 7 file-based routes
    components/     # Shared UI components
    hooks/          # React hooks
    lib/            # Client-side utilities
  shared/           # Types shared between server and client
```

## Key Architecture Decisions

- Claude Code integration is via subprocess spawn (`claude -p --output-format=stream-json --input-format=stream-json`), not SDK
- Auto-approve all tool use (`--permission-mode=bypassPermissions`), no approval UI
- Session logs stay in Claude's native log files, referenced by session ID — not duplicated to DB
- Every repo-linked card gets a git worktree; Claude spawns into the worktree path
- tRPC subscriptions (WebSocket or SSE) stream Claude output to the client
- Card detail: slide-out panel on desktop, full-screen modal on mobile (same component)

## Commands

```bash
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm db:push      # Push schema changes to SQLite
pnpm db:studio    # Open Drizzle Studio
```
