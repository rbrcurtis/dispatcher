import type { AgentType, AgentSession } from './types'
import { ClaudeSession } from './claude/session'
import { KiroSession } from './kiro/session'

export interface CreateSessionOpts {
  agentType: AgentType
  cwd: string
  resumeSessionId?: string
  projectName?: string
  model?: string
  thinkingLevel?: string
  agentProfile?: string
}

export function createAgentSession(opts: CreateSessionOpts): AgentSession {
  switch (opts.agentType) {
    case 'claude':
      return new ClaudeSession(
        opts.cwd,
        opts.resumeSessionId,
        opts.projectName,
        (opts.model ?? 'sonnet') as 'sonnet' | 'opus',
        (opts.thinkingLevel ?? 'high') as 'off' | 'low' | 'medium' | 'high',
      )
    case 'kiro':
      if (!opts.agentProfile) throw new Error('Kiro agent requires agentProfile (HOME path)')
      return new KiroSession(
        opts.cwd,
        opts.agentProfile,
        opts.resumeSessionId,
      )
    default:
      throw new Error(`Unknown agent type: ${opts.agentType}`)
  }
}
