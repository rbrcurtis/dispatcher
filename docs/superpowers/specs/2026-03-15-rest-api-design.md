# REST API Design Spec

## Purpose

Expose a minimal REST API for cards and projects so external agents and scripts can create and manage work items without the WebSocket UI. The API will be wrapped in an MCP server, so clean typing and auto-generated OpenAPI docs are critical.

## Consumers

- AI agents (Claude Code sessions, other LLMs)
- Automation scripts, cron jobs, webhooks
- Eventually an MCP server wrapping these endpoints

No auth in the API itself — trusted callers only. External exposure handled at the infrastructure layer (nginx/CF/Apache bearer token auth).

## Endpoints

### `GET /api/projects`

Returns all projects (id and name only).

**Response:** `{ projects: [{ id: number, name: string }] }`

### `GET /api/cards`

Returns all cards in `ready` column only.

**Response:** `{ cards: [{ id: number, title: string, description: string, projectId: number | null }] }`

`projectId` is nullable because cards created via the WebSocket UI may not have a project. The `column` field is intentionally omitted — all cards returned by this API are always `ready`.

### `POST /api/cards`

Creates a card in `ready` column.

**Request body:**
```json
{ "title": "string", "description": "string", "projectId": 1 }
```

All fields required. `projectId` must reference an existing project (422 if not).

**Response:** `{ id, title, description, projectId }` — 201 Created

### `PUT /api/cards/:id`

Full replacement of the editable fields (title and description) of a ready card. `projectId` is rejected in the body — cards cannot change projects.

**Request body:**
```json
{ "title": "string", "description": "string" }
```

Both fields required (this is PUT, not PATCH — callers send the full editable representation). Returns 404 if card doesn't exist or isn't in `ready`.

**Response:** `{ id, title, description, projectId }`

### `DELETE /api/cards/:id`

Deletes a card in `ready` column. The handler must verify `column === 'ready'` before calling `cardService.deleteCard()` — the service method itself does not check column.

Returns 404 if card doesn't exist or isn't in `ready`.

**Response:** 204 No Content

## Error Responses

Standard JSON error body: `{ error: string }`

| Status | Meaning |
|--------|---------|
| 400 | Validation error (missing/invalid fields) |
| 404 | Card/project not found, or card not in `ready` column |
| 422 | `projectId` doesn't reference an existing project |
| 500 | Unexpected server error |

Handlers must catch ORM errors (e.g., `findOneByOrFail` throws) and map them to appropriate status codes (typically 404).

## OpenAPI & Typing Strategy

Use `@hono/zod-openapi` to define routes. This gives us:

1. **Single source of truth** — Zod schemas define validation, TypeScript types, and OpenAPI docs simultaneously
2. **Auto-generated OpenAPI spec** — served at `/api/doc` (JSON) and `/api/ui` (Swagger UI or similar)
3. **Type-safe route handlers** — request/response types derived from schemas, no manual typing
4. **MCP-ready** — OpenAPI spec can be consumed to auto-generate MCP tool definitions

### Schema structure

Define shared Zod schemas for:
- `cardResponseSchema` — `{ id, title, description, projectId: number | null }` (used in all card responses)
- `cardCreateBodySchema` — `{ title, description, projectId }` (POST body)
- `cardUpdateBodySchema` — `{ title, description }` (PUT body)
- `projectResponseSchema` — `{ id, name }`

These schemas live alongside the route definitions so the OpenAPI spec updates automatically when schemas change.

### Relationship to existing schemas

The existing `cardCreateSchema` in `src/shared/ws-protocol.ts` serves the WebSocket protocol and has different rules (allows any column, title optional, projectId optional). The REST schemas are separate — they enforce the narrower REST API contract (ready-only, all fields required, limited response shape).

## Implementation Notes

### Replacing existing REST code

The current `src/server/api/rest.ts` uses plain Hono with `zValidator`. This will be replaced with `@hono/zod-openapi` route definitions. The existing PATCH and DELETE endpoints that operate on any card (not just ready) will be removed — the WebSocket protocol handles those use cases.

### Card service interaction

The REST handlers call the existing `cardService` methods but enforce additional constraints:
- POST: calls `cardService.createCard()` with `column: 'ready'` hardcoded. Column is hardcoded to `ready` (not just defaulted) to prevent accidental session spawning — `createCard()` auto-starts a Claude session when `column === 'running'`.
- PUT: loads card, verifies `column === 'ready'`, then calls `cardService.updateCard()`
- DELETE: loads card, verifies `column === 'ready'`, then calls `cardService.deleteCard()`. The column guard is in the handler, not the service.
- GET cards: calls `cardService.listCards(['ready'])`

### Response shaping

All card responses are shaped through `cardResponseSchema.parse()` to strip internal fields. This ensures the API never accidentally leaks model, worktree, session, or other internal state.

## File Structure

```
src/server/api/
  rest.ts          — Hono OpenAPI app, route definitions, OpenAPI spec endpoint
  schemas.ts       — Zod schemas for REST API (separate from WS protocol schemas)
```
