# Pi Framework E2E Smoke Test

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Socket.IO-based E2E test suite that validates the full card-to-session lifecycle through the pi framework, reusable for ongoing regression testing.

**Architecture:** Tests run against the pi test services (`orchestrel-pi` on port 6196, `orcd-pi` on `~/.orc/orcd-pi.sock`). A dedicated "Test" project with a temp git repo is created in the DB via Socket.IO before tests run. Tests use Socket.IO client directly (not browser DOM) for speed and reliability -- we're testing the backend integration, not UI rendering. The test project is cleaned up after the suite.

**Tech Stack:** vitest, socket.io-client v4, Node.js `execFileSync` (for git repo setup), SQLite (for DB verification)

**Test target:** `http://localhost:6196` (orchestrel-pi service)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `e2e/setup.ts` | Creates temp git repo, connects Socket.IO, creates "Test" project, exports helpers |
| `e2e/helpers.ts` | Socket.IO emit wrappers with timeouts, event waiters |
| `e2e/smoke.test.ts` | The actual test cases: create card, start session, stream events, follow-up, stop, worktree, session persistence |
| `e2e/vitest.config.ts` | Separate vitest config for e2e (longer timeouts, sequential) |

---

### Task 1: Setup vitest config for E2E

**Files:**
- Create: `e2e/vitest.config.ts`

- [ ] **Step 1: Create the e2e vitest config**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 30_000,
    sequence: { concurrent: false },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
```

This config:
- Only picks up `e2e/` tests (won't run unit tests)
- 120s test timeout (agent sessions can take a while)
- 30s hook timeout (project/repo setup)
- Sequential execution in a single fork (tests share state -- socket connection, project, cards)

- [ ] **Step 2: Add npm script**

In `package.json`, add to `"scripts"`:

```json
"test:e2e": "npx vitest run --config e2e/vitest.config.ts"
```

- [ ] **Step 3: Install socket.io-client**

```bash
pnpm add -D socket.io-client
```

(Check if already installed first -- it may be a transitive dep.)

- [ ] **Step 4: Commit**

```bash
git add e2e/vitest.config.ts package.json
git commit -m "feat: add e2e vitest config and test:e2e script"
```

---

### Task 2: E2E helpers -- Socket.IO wrappers

**Files:**
- Create: `e2e/helpers.ts`

- [ ] **Step 1: Create helpers with typed Socket.IO wrappers**

```typescript
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SyncPayload,
  Card,
  AckResponse,
  AgentStatus,
} from '../src/shared/ws-protocol';

const BASE_URL = process.env.E2E_URL ?? 'http://localhost:6196';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Connect a Socket.IO client to orchestrel-pi. */
export function connect(): Promise<AppSocket> {
  return new Promise((resolve, reject) => {
    const socket: AppSocket = io(BASE_URL, {
      transports: ['websocket'],
      timeout: 10_000,
    }) as AppSocket;

    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(new Error(`Socket.IO connect failed: ${err.message}`)));

    setTimeout(() => reject(new Error('Socket.IO connect timeout')), 10_000);
  });
}

/** Subscribe to columns and get sync payload. */
export function subscribe(
  socket: AppSocket,
  columns: string[] = ['backlog', 'ready', 'running', 'review', 'done'],
): Promise<SyncPayload> {
  return new Promise((resolve, reject) => {
    socket.emit('subscribe', columns as never, (res: AckResponse<SyncPayload>) => {
      if (res.error) reject(new Error(res.error));
      else resolve(res.data!);
    });
    setTimeout(() => reject(new Error('subscribe timeout')), 10_000);
  });
}

/** Emit a typed event with ack and return the result. */
export function emit<T>(
  socket: AppSocket,
  event: string,
  data: unknown,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    (socket as Socket).emit(event, data, (res: AckResponse<T>) => {
      if (res.error) reject(new Error(res.error));
      else resolve(res.data as T);
    });
    setTimeout(() => reject(new Error(`${event} timeout`)), timeoutMs);
  });
}

/** Wait for a specific server push event that matches a predicate. */
export function waitForEvent<T>(
  socket: AppSocket,
  event: string,
  predicate: (data: T) => boolean,
  timeoutMs = 60_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      (socket as Socket).off(event, handler);
      reject(new Error(`waitForEvent(${event}) timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (data: T) => {
      if (predicate(data)) {
        clearTimeout(timer);
        (socket as Socket).off(event, handler);
        resolve(data);
      }
    };

    (socket as Socket).on(event, handler);
  });
}

/** Wait for agent:status with specific cardId and condition. */
export function waitForAgentStatus(
  socket: AppSocket,
  cardId: number,
  predicate: (status: AgentStatus) => boolean,
  timeoutMs = 90_000,
): Promise<AgentStatus> {
  return waitForEvent<AgentStatus>(
    socket,
    'agent:status',
    (s) => s.cardId === cardId && predicate(s),
    timeoutMs,
  );
}

/** Wait for card:updated with specific cardId and column. */
export function waitForCardInColumn(
  socket: AppSocket,
  cardId: number,
  column: string,
  timeoutMs = 90_000,
): Promise<Card> {
  return waitForEvent<Card>(
    socket,
    'card:updated',
    (c) => c.id === cardId && c.column === column,
    timeoutMs,
  );
}

/** Collect session:message events for a card. Returns a stop function. */
export function collectSessionMessages(
  socket: AppSocket,
  cardId: number,
): { messages: unknown[]; stop: () => void } {
  const messages: unknown[] = [];
  const handler = (data: { cardId: number; message: unknown }) => {
    if (data.cardId === cardId) messages.push(data.message);
  };
  (socket as Socket).on('session:message', handler);
  return {
    messages,
    stop: () => (socket as Socket).off('session:message', handler),
  };
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit e2e/helpers.ts --esModuleInterop --module nodenext --moduleResolution nodenext --target es2022 --strict --skipLibCheck 2>&1 | grep -v node_modules/ || echo "clean"
```

- [ ] **Step 3: Commit**

```bash
git add e2e/helpers.ts
git commit -m "feat: add e2e Socket.IO helper wrappers"
```

---

### Task 3: E2E setup -- temp git repo + Test project

**Files:**
- Create: `e2e/setup.ts`

- [ ] **Step 1: Create setup module**

This module:
1. Creates a temp git repo with a README (for worktree tests)
2. Connects Socket.IO
3. Creates a "Test" project pointing at the temp repo
4. Exports everything tests need
5. Tears down on cleanup

Uses `execFileSync` (not `exec`) for safe subprocess calls.

```typescript
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { connect, subscribe, emit } from './helpers';
import type { AppSocket } from './helpers';
import type { Project, SyncPayload } from '../src/shared/ws-protocol';

export const TEST_REPO_DIR = join(tmpdir(), 'orchestrel-e2e-test-repo');

let socket: AppSocket;
let testProject: Project;

/** Create a bare-minimum git repo for testing. */
function createTestRepo(): void {
  if (existsSync(TEST_REPO_DIR)) rmSync(TEST_REPO_DIR, { recursive: true });
  mkdirSync(TEST_REPO_DIR, { recursive: true });
  execFileSync('git', ['init'], { cwd: TEST_REPO_DIR, stdio: 'pipe' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: TEST_REPO_DIR, stdio: 'pipe' });
  writeFileSync(join(TEST_REPO_DIR, 'README.md'), '# E2E Test Repo\n');
  execFileSync('git', ['add', '.'], { cwd: TEST_REPO_DIR, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'add readme'], { cwd: TEST_REPO_DIR, stdio: 'pipe' });
}

/** Remove the temp repo and any worktrees it created. */
function cleanupTestRepo(): void {
  if (existsSync(TEST_REPO_DIR)) {
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: TEST_REPO_DIR, stdio: 'pipe' });
    } catch { /* ignore */ }
    const wtDir = join(TEST_REPO_DIR, '.worktrees');
    if (existsSync(wtDir)) rmSync(wtDir, { recursive: true, force: true });
    rmSync(TEST_REPO_DIR, { recursive: true, force: true });
  }
}

export async function setupE2E(): Promise<{
  socket: AppSocket;
  project: Project;
  sync: SyncPayload;
}> {
  // 1. Create temp git repo
  createTestRepo();

  // 2. Connect to orchestrel-pi
  socket = await connect();

  // 3. Subscribe to get current state
  const sync = await subscribe(socket);

  // 4. Create "Test" project via Socket.IO
  testProject = await emit<Project>(socket, 'project:create', {
    name: 'Test',
    path: TEST_REPO_DIR,
    defaultModel: 'sonnet',
    defaultThinkingLevel: 'off',
    providerID: 'anthropic',
    defaultWorktree: true,
    defaultBranch: 'main',
  });

  console.log(`[e2e] Test project created: id=${testProject.id}, path=${TEST_REPO_DIR}`);

  return { socket, project: testProject, sync };
}

export async function teardownE2E(): Promise<void> {
  // Delete test project from DB
  if (socket?.connected && testProject) {
    try {
      await emit(socket, 'project:delete', { id: testProject.id });
      console.log(`[e2e] Test project deleted: id=${testProject.id}`);
    } catch (err) {
      console.warn(`[e2e] project delete failed:`, err);
    }
  }

  // Disconnect socket
  socket?.disconnect();

  // Clean up temp repo
  cleanupTestRepo();
}

export function getSocket(): AppSocket {
  return socket;
}

export function getProject(): Project {
  return testProject;
}
```

- [ ] **Step 2: Commit**

```bash
git add e2e/setup.ts
git commit -m "feat: add e2e setup -- temp git repo and Test project lifecycle"
```

---

### Task 4: Smoke test -- board connection and card creation

**Files:**
- Create: `e2e/smoke.test.ts`

- [ ] **Step 1: Write the test file with setup/teardown and first two tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { setupE2E, teardownE2E, getSocket, getProject, TEST_REPO_DIR } from './setup';
import {
  subscribe,
  emit,
  waitForCardInColumn,
  waitForAgentStatus,
  collectSessionMessages,
} from './helpers';
import type { Card, Project, AgentStatus } from '../src/shared/ws-protocol';

let project: Project;

// Cards created during tests -- tracked for cleanup
const cardIds: number[] = [];

beforeAll(async () => {
  const result = await setupE2E();
  project = result.project;
}, 30_000);

afterAll(async () => {
  // Delete test cards
  const socket = getSocket();
  for (const id of cardIds) {
    try {
      await emit(socket, 'card:delete', { id });
    } catch { /* may already be deleted */ }
  }
  await teardownE2E();
}, 30_000);

describe('Pi E2E Smoke Tests', () => {
  it('connects and subscribes to the board', async () => {
    const socket = getSocket();
    expect(socket.connected).toBe(true);

    const sync = await subscribe(socket);
    expect(sync.projects).toBeDefined();
    expect(sync.cards).toBeDefined();
    expect(sync.providers).toBeDefined();
    expect(sync.providers['anthropic']).toBeDefined();
  });

  it('creates a card on the Test project', async () => {
    const socket = getSocket();

    const card = await emit<Card>(socket, 'card:create', {
      title: 'Pi smoke test',
      description: 'Create a file called /tmp/pi-smoke-test.txt containing exactly "hello from pi". Do not create any other files.',
      projectId: project.id,
    });

    expect(card.id).toBeGreaterThan(0);
    expect(card.title).toBe('Pi smoke test');
    expect(card.projectId).toBe(project.id);
    expect(card.provider).toBe('anthropic');
    expect(card.model).toBe('sonnet');
    expect(card.thinkingLevel).toBe('off');
    // defaultWorktree=true, so a worktree branch should be assigned
    expect(card.worktreeBranch).toBeTruthy();

    cardIds.push(card.id);
  });
});
```

- [ ] **Step 2: Run to verify connection works**

```bash
npx vitest run --config e2e/vitest.config.ts 2>&1 | tail -20
```

Expected: 2 tests pass (connects, creates card). If connection fails, check `systemctl status orchestrel-pi`.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.test.ts
git commit -m "feat: e2e smoke tests -- connection and card creation"
```

---

### Task 5: Smoke test -- start session, stream events, auto-complete

**Files:**
- Modify: `e2e/smoke.test.ts`

- [ ] **Step 1: Add test for starting a session and seeing it complete**

Append inside the `describe` block, after the card creation test:

```typescript
  it('starts a session via agent:send and receives stream events', async () => {
    const socket = getSocket();
    const cardId = cardIds[0];

    // Start collecting messages before sending
    const collector = collectSessionMessages(socket, cardId);

    // agent:send handles moving card to running + creating session
    await emit(socket, 'agent:send', {
      cardId,
      message: 'Create a file called /tmp/pi-smoke-test.txt containing exactly "hello from pi". Do not create any other files. Do not ask for confirmation.',
    });

    // Wait for session to complete -- card should move to review
    const reviewCard = await waitForCardInColumn(socket, cardId, 'review', 120_000);
    collector.stop();

    expect(reviewCard.column).toBe('review');
    expect(reviewCard.sessionId).toBeTruthy();
    expect(reviewCard.turnsCompleted).toBeGreaterThanOrEqual(1);

    // Verify the agent actually did work -- we should have received stream events
    expect(collector.messages.length).toBeGreaterThan(0);

    // Verify the file was created
    expect(existsSync('/tmp/pi-smoke-test.txt')).toBe(true);
    const content = readFileSync('/tmp/pi-smoke-test.txt', 'utf-8').trim();
    expect(content).toBe('hello from pi');
  }, 120_000);
```

- [ ] **Step 2: Run to verify session lifecycle works end-to-end**

```bash
npx vitest run --config e2e/vitest.config.ts 2>&1 | tail -30
```

Expected: 3 tests pass. The session test may take 30-60s as the agent processes the prompt. Check `journalctl -u orcd-pi --since '5 min ago' --no-pager` for orcd logs if it fails.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.test.ts
git commit -m "feat: e2e test -- session start, stream events, auto-complete to review"
```

---

### Task 6: Smoke test -- follow-up message

**Files:**
- Modify: `e2e/smoke.test.ts`

- [ ] **Step 1: Add follow-up message test**

Append inside the `describe` block:

```typescript
  it('sends a follow-up message to the completed session', async () => {
    const socket = getSocket();
    const cardId = cardIds[0];

    const collector = collectSessionMessages(socket, cardId);

    await emit(socket, 'agent:send', {
      cardId,
      message: 'Append a new line "follow-up works" to /tmp/pi-smoke-test.txt. Do not ask for confirmation.',
    });

    // Wait for it to complete again
    const reviewCard = await waitForCardInColumn(socket, cardId, 'review', 120_000);
    collector.stop();

    expect(reviewCard.column).toBe('review');
    expect(reviewCard.turnsCompleted).toBeGreaterThanOrEqual(2);
    expect(collector.messages.length).toBeGreaterThan(0);

    // Verify file was modified
    const content = readFileSync('/tmp/pi-smoke-test.txt', 'utf-8');
    expect(content).toContain('hello from pi');
    expect(content).toContain('follow-up works');
  }, 120_000);
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run --config e2e/vitest.config.ts 2>&1 | tail -30
```

Expected: 4 tests pass. The follow-up test validates that `OrcdClient.message()` -> `PiSession.sendMessage()` works, and that the card round-trips back to review.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.test.ts
git commit -m "feat: e2e test -- follow-up message to existing session"
```

---

### Task 7: Smoke test -- stop (cancel) a running session

**Files:**
- Modify: `e2e/smoke.test.ts`

- [ ] **Step 1: Add stop/cancel test**

This test creates a second card with a long-running prompt, starts it, then immediately stops it.

Append inside the `describe` block:

```typescript
  it('stops a running session via agent:stop', async () => {
    const socket = getSocket();

    // Create a new card with a long-running task
    const card = await emit<Card>(socket, 'card:create', {
      title: 'Pi stop test',
      description: 'Write a 5000 word essay about the history of computing.',
      projectId: project.id,
    });
    cardIds.push(card.id);

    // Start the session
    await emit(socket, 'agent:send', {
      cardId: card.id,
      message: 'Write a 5000 word essay about the history of computing. Take your time and be thorough.',
    });

    // Wait a moment for the session to actually start producing events
    await new Promise((r) => setTimeout(r, 5_000));

    // Stop it
    await emit(socket, 'agent:stop', { cardId: card.id });

    // Wait for exit status -- should show completed/stopped, not crash
    const status = await waitForAgentStatus(
      socket,
      card.id,
      (s) => !s.active,
      30_000,
    );

    expect(status.active).toBe(false);
    expect(['completed', 'stopped']).toContain(status.status);
  }, 60_000);
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run --config e2e/vitest.config.ts 2>&1 | tail -30
```

Expected: 5 tests pass. The stop test confirms `cancel()` cleanly aborts the pi session without crashing orcd.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.test.ts
git commit -m "feat: e2e test -- stop/cancel a running session"
```

---

### Task 8: Smoke test -- worktree creation

**Files:**
- Modify: `e2e/smoke.test.ts`

- [ ] **Step 1: Add worktree verification test**

This test verifies that the card created in Task 4 (which has `defaultWorktree=true`) actually got a worktree created when the session started.

Append inside the `describe` block:

```typescript
  it('created a worktree for the first card', async () => {
    const socket = getSocket();
    const cardId = cardIds[0];

    // Re-fetch card state
    const sync = await subscribe(socket);
    const card = sync.cards.find((c) => c.id === cardId);

    expect(card).toBeDefined();
    expect(card!.worktreeBranch).toBeTruthy();

    // The worktree should exist on disk at <project_path>/.worktrees/<branch>
    const wtPath = join(TEST_REPO_DIR, '.worktrees', card!.worktreeBranch!);
    expect(existsSync(wtPath)).toBe(true);

    // It should be a valid git worktree (has a .git file or directory)
    const gitPath = join(wtPath, '.git');
    expect(existsSync(gitPath)).toBe(true);
  });
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run --config e2e/vitest.config.ts 2>&1 | tail -30
```

Expected: 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.test.ts
git commit -m "feat: e2e test -- worktree creation verification"
```

---

### Task 9: Smoke test -- session persistence (resume)

**Files:**
- Modify: `e2e/smoke.test.ts`

- [ ] **Step 1: Add session persistence/resume test**

This test verifies that after a session completes, sending another `agent:send` reuses the same `sessionId` (resume flow via `PiSession.sendMessage`). The session ID should not change between the original run and the follow-up.

Append inside the `describe` block:

```typescript
  it('preserves sessionId across follow-up messages (session persistence)', async () => {
    const socket = getSocket();
    const cardId = cardIds[0];

    // Get current card state -- should have a sessionId from earlier tests
    const sync = await subscribe(socket);
    const cardBefore = sync.cards.find((c) => c.id === cardId);
    expect(cardBefore).toBeDefined();
    const sessionIdBefore = cardBefore!.sessionId;
    expect(sessionIdBefore).toBeTruthy();

    // Send another follow-up
    await emit(socket, 'agent:send', {
      cardId,
      message: 'Read /tmp/pi-smoke-test.txt and tell me what it says. Do not modify any files.',
    });

    const reviewCard = await waitForCardInColumn(socket, cardId, 'review', 120_000);

    // sessionId should be unchanged -- same session was reused
    expect(reviewCard.sessionId).toBe(sessionIdBefore);
    expect(reviewCard.turnsCompleted).toBeGreaterThanOrEqual(3);
  }, 120_000);
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run --config e2e/vitest.config.ts 2>&1 | tail -30
```

Expected: 7 tests pass. This validates the resume path -- when `card.sessionId` exists and the session is still tracked as active in `OrcdClient`, it calls `client.message()` instead of `client.create()`.

**Note:** If PiSession's in-memory store has been cleared (e.g., orcd-pi was restarted between tests), the `handleAgentSend` handler will fall through to `client.create()` with the old `sessionId`, which creates a new PiSession with that ID. Either way the sessionId on the card should remain the same. The key thing this test validates is that the card doesn't get a *new* sessionId.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.test.ts
git commit -m "feat: e2e test -- session persistence across follow-ups"
```

---

### Task 10: Verify full suite and cleanup

- [ ] **Step 1: Run the full suite**

```bash
npx vitest run --config e2e/vitest.config.ts 2>&1
```

Expected output: 7 tests pass, 0 failures.

- [ ] **Step 2: Verify orcd-pi didn't crash**

```bash
systemctl is-active orcd-pi
journalctl -u orcd-pi --since '10 min ago' --no-pager | tail -30
```

Expected: `active`, no crash/panic in logs.

- [ ] **Step 3: Verify test cleanup**

The temp repo should be deleted. The Test project should be removed from the DB.

```bash
ls /tmp/orchestrel-e2e-test-repo 2>&1   # should say "No such file or directory"
sqlite3 data/orchestrel.db "SELECT * FROM projects WHERE name = 'Test';"  # should return nothing
```

- [ ] **Step 4: Clean up the smoke test artifact**

```bash
rm -f /tmp/pi-smoke-test.txt
```

- [ ] **Step 5: Commit everything**

```bash
git add -A
git commit -m "feat: complete pi e2e smoke test suite -- 7 tests covering full card lifecycle"
```

---

## Known Gaps (Not Tested)

| Gap | Reason |
|-----|--------|
| `context_usage` wheel updates | PiSession doesn't emit `context_usage` yet -- follow-up task |
| Memory upsert extension | Requires 5+ turns and OpenRouter; out of scope per user request |
| UI DOM rendering | Tests use Socket.IO directly; UI rendering is covered by unit tests |
| Multi-user auth | E2E connects locally (bypasses CF Access auth) |
| Session history loading (`session:load`) | Depends on pi-coding-agent session tree format -- separate follow-up |
