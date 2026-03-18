# Task Queue Chaining Design

## Problem

When multiple cards target the same project without git worktrees (`useWorktree=false`), their agents would run in the same directory simultaneously, causing file conflicts and race conditions. Additionally, users sometimes want to explicitly sequence tasks so one builds on the output of another.

## Solution

Add a `queuePosition` column to the cards table. Cards in the same **conflict group** — defined as `(projectId, useWorktree=false, column='running')` — are serialized: only one runs at a time, the rest queue with numbered positions. The system auto-assigns positions as cards enter `running` and auto-promotes the next card when the active one finishes.

Cards with `useWorktree=true` are never part of a conflict group and always run immediately in their isolated worktrees.

## Data Model

### Card table change

```sql
ALTER TABLE cards ADD COLUMN queue_position INTEGER DEFAULT NULL;
```

### State meanings

| `column`  | `queuePosition` | Meaning                           |
| --------- | --------------- | --------------------------------- |
| `running` | `NULL`          | Active — agent session is running |
| `running` | `1`             | Next in line                      |
| `running` | `N`             | Nth in queue                      |
| any other | always `NULL`   | Not part of any queue             |

### Conflict group

All cards matching: `column = 'running' AND project_id = ? AND use_worktree = 0`.

### Invariant

Within a conflict group, at most one card has `queuePosition = NULL` (the active card). Queue positions are contiguous integers starting at 1.

## Server: Event-Driven Behavior

### New listener: `registerQueueManager(bus, starter)`

Registered in `src/server/controllers/oc.ts` alongside `registerAutoStart` and `registerWorktreeCleanup`. Listens to `board:changed`.

#### Card enters `running` (`newColumn === 'running'`)

1. If card has `useWorktree = true` → ignore (let `registerAutoStart` handle normally)
2. Query the conflict group for this card's project
3. If no other cards in group → set `queuePosition = NULL` (active), let `registerAutoStart` handle it
4. If an active card already exists → assign `queuePosition = max(existing positions) + 1`, save. Do NOT start a session.

#### Card leaves `running` (`oldColumn === 'running'`, any new column)

Triggered by move to another column, deletion, or archival — all produce `board:changed`.

1. Record the departing card's `queuePosition`, then clear it to `NULL`
2. If the card was **active** (`queuePosition` was `NULL`):
   - Find the card with `queuePosition = 1` in the same conflict group
   - Set it to `NULL` (promote to active)
   - Decrement all remaining queued cards by 1
   - Save all affected cards
   - The promoted card is picked up by `registerAutoStart` (it's in `running` with no session and `queuePosition = NULL`)
3. If the card was **queued** (`queuePosition` was a number):
   - Decrement all cards with `queuePosition > removed card's position`
   - Save affected cards

### Modification to `registerAutoStart`

Add a single guard: skip cards where `queuePosition IS NOT NULL`. This prevents queued cards from having sessions started. This is the only change to an existing handler.

### Promotion flow

Promotion does not directly call `startSession`. It sets `queuePosition = NULL` and relies on `registerAutoStart` to notice a card in `running` with no active session. This preserves handler independence and composability.

## WebSocket API

### Existing mutations

No changes needed to `card:update`. Column moves already produce `board:changed` events, which the queue manager handles.

### New mutation: `queue:reorder`

```typescript
{ type: 'queue:reorder', cardId: number, newPosition: number }
```

- `newPosition` is 1-indexed queue position. Cannot set to 0 or NULL (cannot make yourself active).
- Server validates the card is queued (`queuePosition !== null`).
- Reorder logic:
  - Moving forward (e.g., 3→1): cards in range `[newPosition, oldPosition-1]` increment by 1
  - Moving backward (e.g., 1→3): cards in range `[oldPosition+1, newPosition]` decrement by 1
  - Target card gets `newPosition`
- Saves all affected cards (triggers `board:changed` for each via `CardSubscriber`).

### Subscriptions

No new subscription topics needed. Cards already publish `board:changed` on update, and clients subscribing to card updates see `queuePosition` changes in the normal card data flow.

## UI

### Queue badge on card

- Displayed on the right side of the card, to the left of the X/close button
- Only rendered when `card.queuePosition !== null` (queued cards only — active cards show nothing)
- Small badge with the queue number, styled to be unobtrusive but readable
- Use shadcn `Badge` component with a muted variant

### Reorder popover

- Clicking the queue badge opens a shadcn `Popover` anchored to the badge
- Contains a shadcn `Input` with `type="number"`, pre-filled with current position
- Min=1, max=current queue length
- On submit (Enter key or blur), sends `queue:reorder` mutation
- If entered number equals current position, no-op

### Card rendering in `running` column

- **Active card** (`queuePosition = null`): renders exactly as today — spinner, session status indicators, etc.
- **Queued card** (`queuePosition !== null`): renders normally with the queue badge, without active session indicators (no session exists yet)

### UI blocking rules

Current behavior blocks column changes for all `running` cards. New rule:

- **Active card** (`column='running'`, `queuePosition=null`): blocked from column changes via UI. Has a live session.
- **Queued card** (`column='running'`, `queuePosition !== null`): fully movable. No session, no risk. Column dropdown works, dragging works. Moving it out triggers renumbering automatically via the bus.

The blocking condition changes from `card.column === 'running'` to `card.column === 'running' && card.queuePosition === null`.

## Edge Cases & Resilience

### Server restart

Existing startup scan of `running` cards handles recovery. Cards with `queuePosition = NULL` attempt session re-attach. Cards with `queuePosition !== null` are left alone (waiting). If the active card's session is dead, it moves to `review`, triggering promotion of the next queued card via the bus.

### Chain continues on error

If the active card errors out or is manually moved away, the next queued card is promoted regardless. There is no "pause on failure" behavior. If you want to stop the chain, pull remaining cards out of `running`.

### Multiple conflict groups

A project can have worktree cards running concurrently alongside a queue of non-worktree cards. These don't interact — correct by design since the conflict group key requires `useWorktree=false`.

### Rapid column moves

Dragging multiple cards into `running` quickly triggers independent `board:changed` events. SQLite's single-writer lock serializes the conflict group query + position assignment, preventing two cards from both seeing an empty group and both becoming active.

### Card metadata changes while queued

If `projectId` or `useWorktree` is edited on a queued card, it may leave its conflict group. This is an edge case that self-heals as cards complete. Not worth adding validation for.

## Future: Explicit Dependency Chains

This design naturally extends to user-defined sequencing. The `queuePosition` model works for both conflict-avoidance (auto-assigned) and intentional ordering (user-assigned). A future extension could add an explicit `chainId` or allow sequencing cards that DO use worktrees, where the motivation is "card B needs card A's output" rather than directory conflicts.
