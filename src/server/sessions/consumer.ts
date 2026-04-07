import type { ActiveSession } from './types';
import { messageBus } from '../bus';

/** SDK message types to forward to the UI */
const FORWARD_TYPES = new Set([
  'system',
  'stream_event',
  'assistant',
  'result',
  'tool_progress',
  'tool_use_summary',
  'task_started',
  'task_progress',
  'task_notification',
  'rate_limit',
  'status',
]);

/**
 * Consumes the SDK Query async generator for a session.
 * Updates session state, publishes forwarded messages to the bus.
 * Runs as a fire-and-forget async task — one per active session.
 */
export async function consumeSession(
  session: ActiveSession,
  onExit: (session: ActiveSession) => void,
): Promise<void> {
  const { cardId } = session;
  const log = (msg: string) => console.log(`[session:${session.sessionId ?? cardId}] ${msg}`);

  try {
    for await (const msg of session.query) {
      const sdkMsg = msg as Record<string, unknown>;

      switch (sdkMsg.type) {
        case 'system': {
          const sys = sdkMsg as { subtype?: string; session_id?: string };
          if (sys.subtype === 'init' && sys.session_id) {
            session.sessionId = sys.session_id;
            session.status = 'running';
            log(`init sessionId=${sys.session_id}`);
            messageBus.publish(`card:${cardId}:status`, {
              active: true,
              status: session.status,
              sessionId: session.sessionId,
              promptsSent: session.promptsSent,
              turnsCompleted: session.turnsCompleted,
            });
          }
          break;
        }

        case 'assistant':
        case 'stream_event':
          if (session.status !== 'running') {
            session.status = 'running';
            messageBus.publish(`card:${cardId}:status`, {
              active: true,
              status: 'running',
              sessionId: session.sessionId,
              promptsSent: session.promptsSent,
              turnsCompleted: session.turnsCompleted,
            });
          }
          break;

        case 'result': {
          const result = sdkMsg as {
            subtype?: string;
            total_cost_usd?: number;
            usage?: Record<string, unknown>;
            num_turns?: number;
            duration_ms?: number;
          };
          session.turnsCompleted++;
          session.turnCost = result.total_cost_usd ?? 0;
          session.status = 'completed';
          log(`result subtype=${result.subtype} cost=$${session.turnCost} turns=${session.turnsCompleted}`);
          messageBus.publish(`card:${cardId}:status`, {
            active: false,
            status: 'completed',
            sessionId: session.sessionId,
            promptsSent: session.promptsSent,
            turnsCompleted: session.turnsCompleted,
          });
          break;
        }

        case 'rate_limit':
          session.status = 'retry';
          log('rate_limit');
          messageBus.publish(`card:${cardId}:status`, {
            active: true,
            status: 'retry',
            sessionId: session.sessionId,
            promptsSent: session.promptsSent,
            turnsCompleted: session.turnsCompleted,
          });
          break;

        default:
          break;
      }

      // Forward displayable messages to UI subscribers
      if (FORWARD_TYPES.has(sdkMsg.type as string)) {
        messageBus.publish(`card:${cardId}:sdk`, sdkMsg);
      }
    }
  } catch (err) {
    log(`consumer error: ${err}`);
    session.status = 'errored';
    messageBus.publish(`card:${cardId}:sdk`, {
      type: 'error',
      message: String(err),
      timestamp: Date.now(),
    });
  } finally {
    log(`consumer exited (status=${session.status})`);
    messageBus.publish(`card:${cardId}:exit`, {
      sessionId: session.sessionId,
      status: session.status,
    });
    onExit(session);
  }
}
