import type { WebSocket } from 'ws'
import type { ClientMessage, ClaudeMessage } from '../../../shared/ws-protocol'
import type { ConnectionManager } from '../connections'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync, statSync } from 'fs'

const SESSIONS_DIR = join(process.cwd(), 'data', 'sessions')

function parseSessionFile(content: string): Record<string, unknown>[] {
  return content
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line) as Record<string, unknown>
      } catch {
        return null
      }
    })
    .filter((m): m is Record<string, unknown> => m !== null)
}

export async function handleSessionLoad(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: 'session:load' }>,
  connections: ConnectionManager,
): Promise<void> {
  const { requestId, data: { sessionId, cardId } } = msg

  let messages: ClaudeMessage[] = []

  const localPath = join(SESSIONS_DIR, `${sessionId}.jsonl`)
  if (existsSync(localPath)) {
    try {
      const content = await readFile(localPath, 'utf-8')
      const parsed = parseSessionFile(content)
      const filtered = parsed.filter(
        m => m.type === 'assistant' || m.type === 'user' || m.type === 'result' || m.type === 'system'
      )

      // Inject file mtime as fallback timestamp on the last result message (for old sessions without ts)
      const lastResult = [...filtered].reverse().find(m => m.type === 'result' && !m.ts)
      if (lastResult) {
        const mtime = statSync(localPath).mtime.toISOString()
        Object.assign(lastResult, { ts: mtime })
      }

      // Wrap raw SDK messages in ClaudeMessage shape ({ type, message: {...} })
      // User messages already have `message` field; assistant/result/system don't
      messages = filtered.map(m => {
        if (m.message && typeof m.message === 'object') {
          // Already wrapped (e.g. user messages from start/sendUserMessage)
          return m as unknown as ClaudeMessage
        }
        return {
          type: m.type as ClaudeMessage['type'],
          message: m,
          ...(m.isSidechain !== undefined && { isSidechain: m.isSidechain as boolean }),
          ...(m.ts !== undefined && { ts: m.ts as string }),
        } as ClaudeMessage
      })
    } catch (err) {
      console.error(`Failed to load session ${sessionId}:`, err)
    }
  }

  connections.send(ws, {
    type: 'session:history',
    requestId,
    cardId,
    messages,
  })

  // Send mutation:ok so client's mutate() resolves
  connections.send(ws, {
    type: 'mutation:ok',
    requestId,
  })
}
