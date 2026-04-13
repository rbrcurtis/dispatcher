import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { setupE2E, teardownE2E, getSocket, getProject, TEST_REPO_DIR } from './setup';
import {
  subscribe,
  emit,
  joinCard,
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
    expect(card.provider).toBe('trackable');
    expect(card.model).toBe('sonnet');
    expect(card.thinkingLevel).toBe('off');
    // defaultWorktree=true, so a worktree branch should be assigned
    expect(card.worktreeBranch).toBeTruthy();

    cardIds.push(card.id);
  });

  it('starts a session via agent:send and receives stream events', async () => {
    const socket = getSocket();
    const cardId = cardIds[0];

    // Join the card room so session:message events are received
    await joinCard(socket, cardId);

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

  it('sends a follow-up message to the completed session', async () => {
    const socket = getSocket();
    const cardId = cardIds[0];

    // Already in the card room from test 3, but ensure it
    await joinCard(socket, cardId);
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

  it('stops a running session via agent:stop', async () => {
    const socket = getSocket();

    // Create a new card with a long-running task
    const card = await emit<Card>(socket, 'card:create', {
      title: 'Pi stop test',
      description: 'Write a 5000 word essay about the history of computing.',
      projectId: project.id,
    });
    cardIds.push(card.id);

    // Join the card room to receive agent:status events
    await joinCard(socket, card.id);

    // Start listening for inactive status BEFORE sending, so we don't miss the event
    const statusPromise = waitForAgentStatus(
      socket,
      card.id,
      (s) => !s.active,
      55_000,
    );

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
    const status = await statusPromise;

    expect(status.active).toBe(false);
    expect(['completed', 'stopped']).toContain(status.status);
  }, 60_000);

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
});
