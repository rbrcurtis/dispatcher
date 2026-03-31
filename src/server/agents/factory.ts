import type { AgentSession } from './types';
import { OpenCodeSession } from './opencode/session';
import { resolveModel } from './opencode/models';
import { openCodeServer } from '../opencode/server';
import { getOcProviderID } from '../config/providers';

export interface CreateSessionOpts {
  cwd: string;
  providerID: string;
  model: string;
  thinkingLevel: 'off' | 'low' | 'medium' | 'high';
  resumeSessionId?: string;
  projectName?: string;
}

export function createAgentSession(opts: CreateSessionOpts): AgentSession {
  if (!openCodeServer.client) {
    throw new Error('OpenCode server not ready');
  }
  const ocProvider = getOcProviderID(opts.providerID);
  const { modelID, variant } = resolveModel(opts.providerID, opts.model, opts.thinkingLevel);
  return new OpenCodeSession(openCodeServer.client, opts.cwd, opts.providerID, ocProvider, modelID, variant, opts.resumeSessionId);
}
