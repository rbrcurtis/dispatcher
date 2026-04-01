import type { WebSocket } from 'ws';
import type { ServerMessage } from '../../shared/ws-protocol';
import type { UserIdentity } from '../services/user';

export class ConnectionManager {
  private connections = new Set<WebSocket>();
  private identities = new Map<WebSocket, UserIdentity>();

  get size() {
    return this.connections.size;
  }

  add(ws: WebSocket, identity: UserIdentity) {
    this.connections.add(ws);
    this.identities.set(ws, identity);
  }

  remove(ws: WebSocket) {
    this.connections.delete(ws);
    this.identities.delete(ws);
  }

  getIdentity(ws: WebSocket): UserIdentity | undefined {
    return this.identities.get(ws);
  }

  *entries(): IterableIterator<[WebSocket, UserIdentity]> {
    yield* this.identities.entries();
  }

  send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }
}
