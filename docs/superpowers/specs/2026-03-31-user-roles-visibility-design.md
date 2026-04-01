# User Roles & Project Visibility

**Date:** 2026-03-31
**Status:** Approved

## Overview

Add scoped visibility to Orchestrel so that each user only sees cards from projects they're assigned to. This is not an auth/security feature — Cloudflare Access already controls who can reach the app. This is about giving each user a clean, focused view of their own work.

## Roles

- **Admin:** Sees all projects and cards. Can configure projects and assign users. Determined by `ADMIN_EMAILS` environment variable (comma-separated list of emails).
- **User:** Sees only cards from projects they're assigned to. Full card capabilities (create, edit, move, run agents, archive) within their projects. Cannot access project settings.
- **Local/LAN:** Treated as admin with no DB record. Synthetic identity `{ email: 'local', role: 'admin' }`.

## Data Model

### `users` table

| Column     | Type    | Constraints        |
| ---------- | ------- | ------------------ |
| id         | integer | PK, auto-increment |
| email      | text    | unique, not null   |
| role       | text    | default 'user'     |
| created_at | text    |                    |

Role values: `admin`, `user`.

### `project_users` table

| Column     | Type    | Constraints       |
| ---------- | ------- | ----------------- |
| project_id | integer | FK to projects.id |
| user_id    | integer | FK to users.id    |

Composite PK on (project_id, user_id).

### Schema creation

Via `CREATE TABLE` in sqlite3 CLI per project conventions (no TypeORM synchronize). TypeORM entity files added for both tables.

## Identity Flow

1. Client connects to `/ws`
2. Existing CF Access JWT validation runs (`src/server/ws/auth.ts`)
3. If CF JWT present: extract email from token. Find-or-create user record in `users` table. Sync role from `ADMIN_EMAILS` env var on every connect (so promoting a user takes effect on refresh, no logout needed). Attach `{ id, email, role }` to the WebSocket connection.
4. If local/LAN (no JWT): attach synthetic admin identity `{ email: 'local', role: 'admin' }`, no DB record.
5. `ConnectionManager` maps `WebSocket -> UserIdentity` instead of tracking a bare `Set<WebSocket>`.

## Data Filtering & Scoping

### Subscribe handler

When a user subscribes, the server determines their visible project IDs:

- **Admin:** all projects
- **User:** `SELECT project_id FROM project_users WHERE user_id = ?`

The `sync` response only includes:

- Cards whose `project_id` is in the visible set
- Projects in the visible set

Projects are required on cards — no orphan/null-project cards to handle.

### Broadcast scoping

Real-time updates are scoped per-connection:

- `card:updated`, `card:deleted` — only sent to users who can see that card's project
- `project:updated`, `project:deleted` — only sent to users assigned to that project (+ admins)
- When project user assignments change: newly-added users get a sync of the project + its cards; removed users get a project/card removal

### Card creation

When a regular user creates a card, they pick from their visible projects. If they only have one project, it auto-assigns.

## WS Protocol Changes

### `sync` message additions

- `user: { id: number, email: string, role: 'admin' | 'user' }` — current user identity
- `users: Array<{ id: number, email: string, role: string }>` — full user list, admin only (for the multi-select UI). Omitted or empty for regular users.

### `project:update` message

- Add optional `user_ids: number[]` field to existing project update payload
- Server updates `project_users` join table accordingly
- Admin-only — server ignores `user_ids` from non-admin connections

### No new message types

Everything fits into existing `sync`, `project:update`, and broadcast patterns.

## Frontend Changes

### User identity

`RootStore` gets a `currentUser` observable populated from the `sync` message.

### Conditional UI by role

| Element                              | Admin               | User                           |
| ------------------------------------ | ------------------- | ------------------------------ |
| Project settings button              | Visible             | Hidden                         |
| Project config (path, git, commands) | Full access         | Hidden                         |
| User assignment multi-select         | In project settings | Hidden                         |
| Project filter dropdown              | All projects        | Assigned projects only         |
| Card CRUD, column drag-drop, agents  | Full                | Full (within visible projects) |

### User assignment UI (admin only)

In project settings modal, a multi-select showing all known users (from `users` table). Checkboxes or tag-style picker. Changes sent via `project:update` with `user_ids` field.

### No login page

CF Access handles authentication before the app loads.

## REST API

No changes. REST routes remain unprotected — they're a narrow integration surface (ready-column cards only) and auth there is a separate concern.

## Environment Variables

- `ADMIN_EMAILS` — comma-separated list of admin email addresses (e.g., `wednesday@gmail.com`). Checked on every WS connection to sync user roles.
