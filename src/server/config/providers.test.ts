import { describe, it, expect, vi, beforeEach } from 'vitest';

const VALID_YAML = `
socket: ~/.orc/orcd.sock
defaultProvider: anthropic
defaultModel: claude-sonnet-4-6
providers:
  anthropic:
    label: Anthropic
    models:
      sonnet: { label: "Sonnet 4.6", modelID: claude-sonnet-4-6, contextWindow: 200000 }
      opus:   { label: "Opus 4.6",   modelID: claude-opus-4-6,   contextWindow: 200000 }
`;

const EXPECTED_UI_PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    models: {
      sonnet: { label: 'Sonnet 4.6', modelID: 'claude-sonnet-4-6', contextWindow: 200000 },
      opus: { label: 'Opus 4.6', modelID: 'claude-opus-4-6', contextWindow: 200000 },
    },
  },
};

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

async function importModule() {
  const mod = await import('./providers');
  return mod;
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const fs = await import('fs');
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(VALID_YAML);
});

describe('loadProviders()', () => {
  it('loads and parses a valid YAML config', async () => {
    const { loadProviders } = await importModule();
    expect(loadProviders()).toEqual({ providers: EXPECTED_UI_PROVIDERS });
  });

  it('throws when the file does not exist', async () => {
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const { loadProviders } = await importModule();
    expect(() => loadProviders()).toThrow(/Config not found/);
  });

  it('throws when YAML fails schema validation (missing modelID)', async () => {
    const fs = await import('fs');
    vi.mocked(fs.readFileSync).mockReturnValue(`
providers:
  anthropic:
    label: Anthropic
    models:
      sonnet: { label: "Sonnet 4.6" }
`);
    const { loadProviders } = await importModule();
    expect(() => loadProviders()).toThrow(/modelID/);
  });

  it('caches the result and only reads the file once', async () => {
    const [fs, { loadProviders }] = await Promise.all([import('fs'), importModule()]);

    loadProviders();
    loadProviders();
    loadProviders();

    expect(vi.mocked(fs.readFileSync)).toHaveBeenCalledTimes(1);
  });
});

describe('getProvidersForClient()', () => {
  it('returns the providers map', async () => {
    const { getProvidersForClient } = await importModule();
    expect(getProvidersForClient()).toEqual(EXPECTED_UI_PROVIDERS);
  });
});

describe('getModelConfig()', () => {
  it('returns the model config for a valid provider and alias', async () => {
    const { getModelConfig } = await importModule();
    expect(getModelConfig('anthropic', 'sonnet')).toEqual(
      EXPECTED_UI_PROVIDERS.anthropic.models.sonnet,
    );
  });

  it('returns undefined for an unknown provider', async () => {
    const { getModelConfig } = await importModule();
    expect(getModelConfig('unknown-provider', 'sonnet')).toBeUndefined();
  });

  it('returns undefined for an unknown model alias', async () => {
    const { getModelConfig } = await importModule();
    expect(getModelConfig('anthropic', 'nonexistent-model')).toBeUndefined();
  });
});

describe('getDefaultModel()', () => {
  it('returns the first model key for a known provider', async () => {
    const { getDefaultModel } = await importModule();
    expect(getDefaultModel('anthropic')).toBe('sonnet');
  });

  it("falls back to 'sonnet' for an unknown provider", async () => {
    const { getDefaultModel } = await importModule();
    expect(getDefaultModel('unknown-provider')).toBe('sonnet');
  });
});

describe('getDefaultProviderID()', () => {
  it('returns the first provider key from config', async () => {
    const { getDefaultProviderID } = await importModule();
    expect(getDefaultProviderID()).toBe('anthropic');
  });

  it('throws when no providers are configured', async () => {
    const fs = await import('fs');
    vi.mocked(fs.readFileSync).mockReturnValue(`
socket: ~/.orc/orcd.sock
defaultProvider: anthropic
defaultModel: claude-sonnet-4-6
providers: {}
`);
    const { getDefaultProviderID } = await importModule();
    expect(() => getDefaultProviderID()).toThrow(/No providers configured/);
  });
});
