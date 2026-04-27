import { describe, expect, it } from 'vitest';
import { SessionStore } from './session-store';
import type { SdkMessage } from '../lib/sdk-types';

function startBlockingSubagent(store: SessionStore, cardId: number): void {
  store.ingestSdkMessage(cardId, {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call_agent', name: 'Agent' },
    },
  } as SdkMessage);
  store.ingestSdkMessage(cardId, {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"description":"Review subagent UI fix"}' },
    },
  } as SdkMessage);
  store.ingestSdkMessage(cardId, {
    type: 'stream_event',
    event: { type: 'content_block_stop', index: 0 },
  } as SdkMessage);
}

describe('SessionStore subagent lifecycle', () => {
  it('clears subagents when agent status is terminal', () => {
    const store = new SessionStore();
    startBlockingSubagent(store, 1011);

    store.handleAgentStatus({
      cardId: 1011,
      active: false,
      status: 'completed',
      sessionId: 'sess-abc',
      promptsSent: 1,
      turnsCompleted: 1,
      contextTokens: 0,
      contextWindow: 200000,
    });

    expect(store.getSession(1011)?.accumulator.subagents.size).toBe(0);
  });

  it('clears subagents when session exits', () => {
    const store = new SessionStore();
    startBlockingSubagent(store, 1011);

    store.handleSessionExit(1011);

    expect(store.getSession(1011)?.accumulator.subagents.size).toBe(0);
  });
});
