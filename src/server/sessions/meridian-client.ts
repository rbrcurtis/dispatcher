import { parseSSEStream, type SSEEvent } from './sse-parser';

const MERIDIAN_URL = process.env.MERIDIAN_URL ?? 'http://127.0.0.1:3456';

export interface MeridianRequestOpts {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  system?: string;
  sessionId: string;
  profile?: string; // meridian profile name (e.g. 'kiro')
  signal?: AbortSignal;
  maxTokens?: number;
}

export interface MeridianSession {
  events: AsyncGenerator<SSEEvent>;
  response: Response;
  abort: () => void;
}

/**
 * Send a streaming request to meridian and return the SSE event stream.
 */
export async function sendToMeridian(opts: MeridianRequestOpts): Promise<MeridianSession> {
  const controller = new AbortController();
  if (opts.signal) {
    opts.signal.addEventListener('abort', () => controller.abort());
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': 'orchestrel',
    'x-opencode-session': opts.sessionId,
  };
  if (opts.profile) {
    headers['x-meridian-profile'] = opts.profile;
  }

  const body = JSON.stringify({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 16384,
    stream: true,
    ...(opts.system ? { system: opts.system } : {}),
    messages: opts.messages,
  });

  const response = await fetch(`${MERIDIAN_URL}/v1/messages`, {
    method: 'POST',
    headers,
    body,
    signal: controller.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Meridian error ${response.status}: ${text}`);
  }

  if (!response.body) {
    throw new Error('Meridian returned no body');
  }

  return {
    events: parseSSEStream(response.body as unknown as AsyncIterable<Uint8Array>),
    response,
    abort: () => controller.abort(),
  };
}
