import { Card } from '../models/Card'
import { Project } from '../models/Project'
import { messageBus, type MessageBus } from '../bus'
import type { AgentSession, AgentMessage } from '../agents/types'

const DISPLAY_TYPES = new Set([
  'user', 'text', 'tool_call', 'tool_result', 'tool_progress',
  'thinking', 'system', 'turn_end', 'error',
])

/**
 * Wire independent event handlers on an OC session.
 * Each handler is a separate session.on() call — no handler blocks another.
 * The bus parameter defaults to the singleton for production; tests inject a fresh instance.
 */
export function wireSession(cardId: number, session: AgentSession, bus: MessageBus = messageBus): void {
  // Handler: forward displayable content to domain bus
  session.on('message', (msg: AgentMessage) => {
    if (!DISPLAY_TYPES.has(msg.type)) return
    bus.publish(`card:${cardId}:message`, msg)
  })

  // Handler: persist counters + move card to review on turn_end
  // These MUST be in one handler to avoid a lost-update race (both would
  // load the same row, mutate different fields, and the last save wins).
  session.on('message', async (msg: AgentMessage) => {
    if (msg.type !== 'turn_end') return
    try {
      const card = await Card.findOneBy({ id: cardId })
      if (!card) return
      card.promptsSent = session.promptsSent
      card.turnsCompleted = session.turnsCompleted
      if (card.column === 'running') card.column = 'review'
      card.updatedAt = new Date().toISOString()
      await card.save()
    } catch (err) {
      console.error(`[oc:${cardId}] failed to handle turn_end:`, err)
    }
  })

  // Handler: move card to review on exit (errored/stopped only)
  session.on('exit', async () => {
    if (session.status === 'errored' || session.status === 'stopped') {
      try {
        const card = await Card.findOneBy({ id: cardId })
        if (card && card.column === 'running') {
          card.column = 'review'
          card.promptsSent = session.promptsSent
          card.turnsCompleted = session.turnsCompleted
          card.updatedAt = new Date().toISOString()
          await card.save()
        }
      } catch (err) {
        console.error(`[oc:${cardId}] failed to move card to review on exit:`, err)
      }
    }
  })

  // Handler: publish exit status to domain bus
  session.on('exit', () => {
    bus.publish(`card:${cardId}:exit`, {
      cardId,
      active: false,
      status: session.status,
      sessionId: session.sessionId,
      promptsSent: session.promptsSent,
      turnsCompleted: session.turnsCompleted,
    })
  })

  // Handler: forward session status changes to domain bus
  session.on('statusChange', () => {
    bus.publish(`card:${cardId}:session-status`, {
      cardId,
      active: session.status === 'running' || session.status === 'starting' || session.status === 'retry',
      status: session.status,
      sessionId: session.sessionId,
      promptsSent: session.promptsSent,
      turnsCompleted: session.turnsCompleted,
    })
  })
}

// --- Domain bus listeners (registered once at startup) ---

interface SessionStarter {
  startSession(cardId: number, message?: string): Promise<void>
}

export function registerAutoStart(bus: MessageBus = messageBus, starter: SessionStarter): void {
  bus.subscribe('board:changed', (payload) => {
    const { card, oldColumn, newColumn } = payload as {
      card: Card | null; oldColumn: string | null; newColumn: string | null
    }
    if (!card) return
    if (newColumn !== 'running') return
    if (oldColumn === 'running') return

    starter.startSession(card.id, undefined).catch(err => {
      console.error(`[oc:auto-start] failed for card ${card.id}:`, err)
    })
  })
}

interface WorktreeOps {
  removeWorktree(repoPath: string, worktreePath: string): void
  worktreeExists(worktreePath: string): boolean
}

export function registerWorktreeCleanup(bus: MessageBus = messageBus, ops: WorktreeOps): void {
  bus.subscribe('board:changed', async (payload) => {
    const { card, oldColumn, newColumn } = payload as {
      card: Card | null; oldColumn: string | null; newColumn: string | null
    }
    if (!card) return
    if (newColumn !== 'archive' || oldColumn === 'archive') return

    const c = card as Card
    if (!c.useWorktree || !c.worktreePath || !c.projectId) return

    try {
      const proj = await Project.findOneBy({ id: c.projectId })
      if (!proj || !ops.worktreeExists(c.worktreePath)) return
      ops.removeWorktree(proj.path, c.worktreePath)
      console.log(`[oc:worktree] removed ${c.worktreePath}`)
    } catch (err) {
      console.error(`[oc:worktree] cleanup failed for card ${c.id}:`, err)
    }
  })
}
