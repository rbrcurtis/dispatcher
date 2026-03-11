import type { WebSocket } from 'ws'
import { db } from '../db/index'
import { cards, projects } from '../db/schema'
import { eq } from 'drizzle-orm'
import { sessionManager } from './manager'
import type { ClaudeSession } from './protocol'
import type { ConnectionManager } from '../ws/connections'
import type { DbMutator } from '../db/mutator'
import type { SessionStatus } from './types'
import type { ClaudeMessage } from '../../shared/ws-protocol'
import {
  createWorktree,
  runSetupCommands,
  slugify,
  worktreeExists,
} from '../worktree'

function waitForInit(s: ClaudeSession): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for session init')), 30_000)
    const onMessage = () => {
      if (s.sessionId) {
        clearTimeout(timeout)
        s.off('message', onMessage)
        resolve()
      }
    }
    s.on('message', onMessage)
    s.on('exit', () => {
      clearTimeout(timeout)
      s.off('message', onMessage)
      reject(new Error('Session exited before init'))
    })
  })
}

function registerHandlers(
  session: ClaudeSession,
  cardId: number,
  ws: WebSocket,
  connections: ConnectionManager,
  mutator: DbMutator,
) {
  session.on('message', async (msg: Record<string, unknown>) => {
    const knownTypes = new Set(['user', 'assistant', 'result', 'system'])
    if (!knownTypes.has(msg.type as string)) return

    const innerMsg = (msg.message && typeof msg.message === 'object')
      ? msg.message as Record<string, unknown>
      : msg
    const wrapped: ClaudeMessage = {
      type: msg.type as ClaudeMessage['type'],
      message: innerMsg,
      ...(msg.isSidechain !== undefined && { isSidechain: msg.isSidechain as boolean }),
      ...(msg.ts !== undefined && { ts: msg.ts as string }),
    }
    connections.send(ws, {
      type: 'claude:message',
      cardId,
      data: wrapped,
    })

    if (msg.type === 'result') {
      try {
        mutator.updateCard(cardId, {
          promptsSent: session.promptsSent,
          turnsCompleted: session.turnsCompleted,
        })
      } catch (err) {
        console.error(`[session:${cardId}] failed to persist counters:`, err)
      }
    }
  })

  session.on('exit', async () => {
    console.log(`[session:${cardId}] exit, status=${session.status}`)
    if (session.status !== 'completed' && session.status !== 'errored') return
    try {
      mutator.updateCard(cardId, {
        column: 'review',
        promptsSent: session.promptsSent,
        turnsCompleted: session.turnsCompleted,
      })
    } catch (err) {
      console.error(`[session:${cardId}] failed to auto-move to review:`, err)
    }
    connections.send(ws, {
      type: 'claude:status',
      data: {
        cardId,
        active: false,
        status: session.status as SessionStatus,
        sessionId: session.sessionId,
        promptsSent: session.promptsSent,
        turnsCompleted: session.turnsCompleted,
      },
    })
  })
}

function ensureWorktree(card: {
  id: number
  projectId: number | null
  useWorktree: boolean
  worktreePath: string | null
  worktreeBranch: string | null
  sourceBranch: string | null
  title: string
}, mutator: DbMutator): string {
  if (card.worktreePath) return card.worktreePath

  if (!card.projectId) throw new Error(`Card ${card.id} has no project`)
  const proj = db.select().from(projects).where(eq(projects.id, card.projectId)).get()
  if (!proj) throw new Error(`Project ${card.projectId} not found`)

  if (!card.useWorktree) {
    mutator.updateCard(card.id, { worktreePath: proj.path })
    return proj.path
  }

  const slug = card.worktreeBranch || slugify(card.title)
  const wtPath = `${proj.path}/.worktrees/${slug}`
  const branch = slug
  const source = card.sourceBranch ?? proj.defaultBranch ?? undefined

  if (!worktreeExists(wtPath)) {
    console.log(`[session:${card.id}] worktree setup at ${wtPath}`)
    createWorktree(proj.path, wtPath, branch, source ?? undefined)
    if (proj.setupCommands) {
      runSetupCommands(wtPath, proj.setupCommands)
    }
  }

  mutator.updateCard(card.id, { worktreePath: wtPath, worktreeBranch: branch })
  return wtPath
}

export async function beginSession(
  cardId: number,
  message: string | undefined,
  ws: WebSocket,
  connections: ConnectionManager,
  mutator: DbMutator,
): Promise<void> {
  const card = db.select().from(cards).where(eq(cards.id, cardId)).get()
  if (!card) throw new Error(`Card ${cardId} not found`)
  if (!card.description) throw new Error(`Card ${cardId} has no description`)

  const existingSession = sessionManager.get(cardId)
  console.log(`[session:${cardId}] beginSession called, existingSession=${!!existingSession}, message=${!!message}`)

  if (existingSession) {
    // Existing session — send follow-up
    if (!message) throw new Error(`No message to send to existing session for card ${cardId}`)
    console.log(`[session:${cardId}] existing session, sending follow-up`)

    // Re-register handlers to current WS connection
    existingSession.removeAllListeners('message')
    existingSession.removeAllListeners('exit')
    registerHandlers(existingSession, cardId, ws, connections, mutator)

    // Refresh model/thinkingLevel from DB
    existingSession.model = card.model
    existingSession.thinkingLevel = card.thinkingLevel

    await existingSession.sendUserMessage(message)

    mutator.updateCard(cardId, { promptsSent: existingSession.promptsSent })

    connections.send(ws, {
      type: 'claude:status',
      data: {
        cardId,
        active: true,
        status: 'running',
        sessionId: card.sessionId,
        promptsSent: existingSession.promptsSent,
        turnsCompleted: existingSession.turnsCompleted,
      },
    })
  } else {
    // New session
    const prompt = message ? card.description + '\n' + message : card.description
    console.log(`[session:${cardId}] no session, creating. prompt length=${prompt.length}`)

    const cwd = ensureWorktree(card, mutator)

    let projectName: string | undefined
    if (card.projectId) {
      const proj = db.select({ name: projects.name }).from(projects).where(eq(projects.id, card.projectId)).get()
      if (proj) projectName = proj.name.toLowerCase()
    }

    const isResume = !!card.sessionId
    const session = sessionManager.create(
      cardId,
      cwd,
      card.sessionId ?? undefined,
      projectName,
      card.model,
      card.thinkingLevel,
    )

    // Restore counters from DB for resumed sessions (e.g. after server restart)
    if (isResume) {
      session.promptsSent = card.promptsSent ?? 0
      session.turnsCompleted = card.turnsCompleted ?? 0
    }

    registerHandlers(session, cardId, ws, connections, mutator)

    session.promptsSent++
    await session.start(prompt)
    await waitForInit(session)

    if (!isResume) {
      mutator.updateCard(cardId, {
        sessionId: session.sessionId,
        promptsSent: 1,
        turnsCompleted: 0,
      })
    }

    connections.send(ws, {
      type: 'claude:status',
      data: {
        cardId,
        active: true,
        status: 'running',
        sessionId: session.sessionId,
        promptsSent: session.promptsSent,
        turnsCompleted: session.turnsCompleted,
      },
    })
  }
}
