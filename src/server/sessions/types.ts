// src/server/sessions/types.ts

export type SessionStatus = 'starting' | 'running' | 'completed' | 'errored' | 'stopped' | 'retry';

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ActiveSession {
  cardId: number;
  sessionId: string | null;
  meridianSessionId: string; // x-opencode-session value
  provider: string;
  model: string;
  status: SessionStatus;
  promptsSent: number;
  turnsCompleted: number;
  turnCost: number;
  turnUsage: Usage | null;
  cwd: string;
  abortController: AbortController;
  stopTimeout: ReturnType<typeof setTimeout> | null;
}

export interface SessionStartOpts {
  provider: string;
  model: string;
  resume?: string;
}
