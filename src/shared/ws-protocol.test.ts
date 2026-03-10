import { describe, it, expect } from 'vitest'
import { cardSchema, clientMessage, serverMessage } from './ws-protocol'

describe('cardSchema', () => {
  it('validates a full card row', () => {
    const card = {
      id: 1,
      title: 'My task',
      description: 'Details here',
      column: 'ready',
      position: 1.5,
      projectId: 2,
      prUrl: null,
      sessionId: null,
      worktreePath: null,
      worktreeBranch: null,
      useWorktree: true,
      sourceBranch: null,
      model: 'sonnet',
      thinkingLevel: 'high',
      promptsSent: 0,
      turnsCompleted: 0,
      createdAt: '2024-01-01T00:00:00',
      updatedAt: '2024-01-01T00:00:00',
    }
    const result = cardSchema.safeParse(card)
    expect(result.success).toBe(true)
  })

  it('rejects invalid column', () => {
    const card = {
      id: 1,
      title: 'My task',
      description: '',
      column: 'invalid_column',
      position: 0,
      projectId: null,
      prUrl: null,
      sessionId: null,
      worktreePath: null,
      worktreeBranch: null,
      useWorktree: false,
      sourceBranch: null,
      model: 'sonnet',
      thinkingLevel: 'off',
      promptsSent: 0,
      turnsCompleted: 0,
      createdAt: '2024-01-01T00:00:00',
      updatedAt: '2024-01-01T00:00:00',
    }
    const result = cardSchema.safeParse(card)
    expect(result.success).toBe(false)
  })
})

describe('clientMessage', () => {
  it('parses subscribe', () => {
    const msg = { type: 'subscribe', data: { column: 'ready' } }
    const result = clientMessage.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.type).toBe('subscribe')
  })

  it('parses card:move', () => {
    const msg = {
      type: 'card:move',
      data: { id: 5, column: 'in_progress', position: 2.0 },
    }
    const result = clientMessage.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('card:move')
    }
  })

  it('rejects unknown type', () => {
    const msg = { type: 'unknown:action', data: {} }
    const result = clientMessage.safeParse(msg)
    expect(result.success).toBe(false)
  })
})

describe('serverMessage', () => {
  it('parses sync', () => {
    const msg = {
      type: 'sync',
      data: {
        cards: [],
        projects: [],
      },
    }
    const result = serverMessage.safeParse(msg)
    expect(result.success).toBe(true)
  })

  it('parses mutation:ok', () => {
    const msg = {
      type: 'mutation:ok',
      data: { requestId: 'req-1', result: { id: 42 } },
    }
    const result = serverMessage.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.type).toBe('mutation:ok')
  })

  it('parses card:updated', () => {
    const card = {
      id: 3,
      title: 'Updated',
      description: '',
      column: 'done',
      position: 0,
      projectId: null,
      prUrl: null,
      sessionId: null,
      worktreePath: null,
      worktreeBranch: null,
      useWorktree: false,
      sourceBranch: null,
      model: 'sonnet',
      thinkingLevel: 'off',
      promptsSent: 1,
      turnsCompleted: 1,
      createdAt: '2024-01-01T00:00:00',
      updatedAt: '2024-01-02T00:00:00',
    }
    const msg = { type: 'card:updated', data: { card } }
    const result = serverMessage.safeParse(msg)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.type).toBe('card:updated')
  })
})
