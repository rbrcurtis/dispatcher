/* oxlint-disable orchestrel/log-before-early-return -- pure config loader */
import { loadConfig } from '../../shared/config';
import type { ModelDef, ProviderDef } from '../../shared/config';

export type ModelConfig = ModelDef;

/** UI-facing provider shape — requires label for display. */
export interface ProviderConfig {
  label: string;
  models: Record<string, ModelConfig>;
}

export interface ProvidersConfig {
  providers: Record<string, ProviderConfig>;
}

function toUIShape(p: ProviderDef, id: string): ProviderConfig {
  return {
    label: p.label ?? id,
    models: p.models,
  };
}

export function loadProviders(): ProvidersConfig {
  const cfg = loadConfig();
  const providers: Record<string, ProviderConfig> = {};
  for (const [id, p] of Object.entries(cfg.providers)) {
    providers[id] = toUIShape(p, id);
  }
  return { providers };
}

/** Serializable providers map for the frontend. */
export function getProvidersForClient(): ProvidersConfig['providers'] {
  return loadProviders().providers;
}

/** Look up a model config by provider + model alias. */
export function getModelConfig(providerID: string, modelAlias: string): ModelConfig | undefined {
  return loadProviders().providers[providerID]?.models[modelAlias];
}

/** First model alias for a provider (used as default). */
export function getDefaultModel(providerID: string): string {
  const provider = loadProviders().providers[providerID];
  if (!provider) return 'sonnet';
  const keys = Object.keys(provider.models);
  return keys[0] ?? 'sonnet';
}

/** First provider key from config (used as system-wide default). */
export function getDefaultProviderID(): string {
  const keys = Object.keys(loadProviders().providers);
  if (!keys.length) throw new Error('No providers configured in config.yaml');
  return keys[0];
}
