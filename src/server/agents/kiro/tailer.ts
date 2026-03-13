import { EventEmitter } from 'events'
import { watch, openSync, readSync, closeSync, statSync, existsSync, readFileSync, readdirSync } from 'fs'
import type { FSWatcher } from 'fs'
import { join } from 'path'
import { normalizeKiroMessage } from './messages'
import type { AgentMessage } from '../types'

const STALE_TIMEOUT = 120_000
const FILE_POLL_INTERVAL = 500
const FILE_POLL_TIMEOUT = 30_000

export class KiroSessionTailer extends EventEmitter {
  private watcher: FSWatcher | null = null
  private offset = 0
  private staleTimer: NodeJS.Timeout | null = null
  private partial = ''
  private pollTimer: NodeJS.Timeout | null = null
  private resolvedPath: string | null

  constructor(
    filePath: string | null,
    private readonly sessionDir: string,
    public readonly cardId: number,
  ) {
    super()
    this.resolvedPath = filePath
  }

  get filePath(): string | null {
    return this.resolvedPath
  }

  /** Start tailing — polls for file creation if it doesn't exist yet */
  start(): void {
    if (this.resolvedPath && existsSync(this.resolvedPath)) {
      this.beginTailing()
    } else {
      this.pollForFile()
    }
  }

  private pollForFile(): void {
    const started = Date.now()
    this.pollTimer = setInterval(() => {
      // If we don't have a resolved path yet, scan the session dir for a .jsonl file
      if (!this.resolvedPath && existsSync(this.sessionDir)) {
        try {
          const files = readdirSync(this.sessionDir)
          const jsonl = files.find(f => f.endsWith('.jsonl'))
          if (jsonl) this.resolvedPath = join(this.sessionDir, jsonl)
        } catch { /* dir may not exist yet */ }
      }
      if (this.resolvedPath && existsSync(this.resolvedPath)) {
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
        this.beginTailing()
      } else if (Date.now() - started > FILE_POLL_TIMEOUT) {
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
        console.error(`[KiroTailer:${this.cardId}] file not created within ${FILE_POLL_TIMEOUT}ms in ${this.sessionDir}`)
        this.emit('stale')
      }
    }, FILE_POLL_INTERVAL)
  }

  private beginTailing(): void {
    // Start from offset 0 — this tailer is the sole event source for Kiro sessions.
    // All events since session start must be emitted.
    this.offset = 0
    this.readNewLines() // Emit any events already written
    this.resetStaleTimer()
    this.watcher = watch(this.resolvedPath!, () => {
      this.readNewLines()
      this.resetStaleTimer()
    })
  }

  /** Read full file and normalize all events (for history replay) */
  readHistory(): AgentMessage[] {
    if (!this.resolvedPath || !existsSync(this.resolvedPath)) return []
    try {
      const content = readFileSync(this.resolvedPath, 'utf-8')
      const messages: AgentMessage[] = []
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          const raw = JSON.parse(line) as Record<string, unknown>
          const msg = normalizeKiroMessage(raw)
          if (msg) messages.push(msg)
        } catch { /* skip bad lines */ }
      }
      return messages
    } catch {
      return []
    }
  }

  private readNewLines(): void {
    if (!this.resolvedPath) return
    try {
      const size = statSync(this.resolvedPath).size
      if (size <= this.offset) return

      const fd = openSync(this.resolvedPath, 'r')
      const len = size - this.offset
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, this.offset)
      closeSync(fd)
      this.offset = size

      const text = this.partial + buf.toString('utf-8')
      const lines = text.split('\n')
      this.partial = lines.pop() ?? ''

      for (const line of lines) {
        if (!line) continue
        try {
          const raw = JSON.parse(line) as Record<string, unknown>
          const msg = normalizeKiroMessage(raw)
          if (msg) this.emit('message', msg)
        } catch { /* skip bad lines */ }
      }
    } catch (err) {
      console.error('[KiroTailer] Read error:', err)
    }
  }

  private resetStaleTimer(): void {
    if (this.staleTimer) clearTimeout(this.staleTimer)
    this.staleTimer = setTimeout(() => {
      this.emit('stale')
      this.stop()
    }, STALE_TIMEOUT)
  }

  stop(): void {
    if (this.watcher) { this.watcher.close(); this.watcher = null }
    if (this.staleTimer) { clearTimeout(this.staleTimer); this.staleTimer = null }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    this.partial = ''
    this.removeAllListeners()
  }
}
