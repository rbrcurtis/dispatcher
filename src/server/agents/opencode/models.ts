type Model = 'sonnet' | 'opus'
type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

interface ResolvedModel {
  modelID: string
  variant?: string
}

const BASE_MODEL: Record<Model, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
}

const KIRO_VARIANT: Record<ThinkingLevel, string | undefined> = {
  off: undefined,
  low: 'low',
  medium: 'medium',
  high: 'max',
}

export function resolveModel(
  provider: string,
  model: Model = 'sonnet',
  thinkingLevel: ThinkingLevel = 'high',
): ResolvedModel {
  const base = BASE_MODEL[model] ?? BASE_MODEL.sonnet

  if (provider === 'anthropic') {
    return {
      modelID: base,
      variant: thinkingLevel === 'off' ? undefined : thinkingLevel,
    }
  }

  return {
    modelID: thinkingLevel === 'off' ? base : `${base}-thinking`,
    variant: KIRO_VARIANT[thinkingLevel],
  }
}
