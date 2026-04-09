import type { Server as HttpServer } from 'http'
import type { Http2SecureServer } from 'http2'
import type { Server as IoServer } from 'socket.io'

type AnyHttpServer = HttpServer | Http2SecureServer

/** SessionManager — survives Vite restarts. */
import type { SessionManager } from './sessions/manager'
let _sessionManager: SessionManager | null = null
export function getSessionManager(): SessionManager | null { return _sessionManager }
export function setSessionManager(sm: SessionManager): void { _sessionManager = sm }

/** True after IO server, bus listeners, and SessionManager are initialized. */
export let initialized = false
export function markInitialized() { initialized = true }

/** Cached Socket.IO Server — reused across Vite restarts. */
export let io: IoServer | null = null
export function setIo(instance: IoServer) { io = instance }

/** httpServer from server.js — arrives via process event, persists across restarts. */
let _httpServer: AnyHttpServer | null = null
const _httpServerReady = new Promise<AnyHttpServer>((resolve) => {
  if (_httpServer) { resolve(_httpServer); return }
  process.once('orchestrel:httpServer', (server: AnyHttpServer) => {
    _httpServer = server
    resolve(server)
  })
})

export function getHttpServer(): Promise<AnyHttpServer> {
  if (_httpServer) return Promise.resolve(_httpServer)
  return _httpServerReady
}
