import { describe, it, expect, vi, beforeEach } from 'vitest';

const VALID_CONFIG = {
  providers: {
    anthropic: {
      label: 'Anthropic',
      models: {
        sonnet: { label: 'Sonnet 4.6', modelID: 'claude-sonnet-4-6', contextWindow: 200000 },
        opus: { label: 'Opus 4.6', modelID: 'claude-opus-4-6', contextWindow: 200000 },
      },
    },
  },
};

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Re-import the module fresh in each test so the `cached` variable is reset.
async function importModule() {
  const { loadProviders, getProvidersForClient, getModelConfig, getDefaultModel, getOcProviderID, getDefaultProviderID } = await import(
    './providers'
  );
  return { loadProviders, getProvidersForClient, getModelConfig, getDefaultModel, getOcProviderID, getDefaultProviderID };
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const fs = await import('fs');
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(VALID_CONFIG));
});

describe('loadProviders()', () => {
  it('loads and parses a valid config file', async () => {
    const { loadProviders } = await importModule();
    const config = loadProviders();
    expect(config).toEqual(VALID_CONFIG);
  });

  it('throws when the file does not exist', async () => {
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const { loadProviders } = await importModule();
    expect(() => loadProviders()).toThrow('Provider config not found');
  });

  it('throws when JSON fails schema validation (missing required fields)', async () => {
    const fs = await import('fs');
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ providers: { anthropic: { label: 'Anthropic' } } }),
    );

    const { loadProviders } = await importModule();
    expect(() => loadProviders()).toThrow();
  });

  it('caches the result and only reads the file once', async () => {
    // Import fs and the module in the same reset cycle so we hold the same spy
    // instance that the module under test will call.
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
    const providers = getProvidersForClient();
    expect(providers).toEqual(VALID_CONFIG.providers);
  });
});

describe('getModelConfig()', () => {
  it('returns the model config for a valid provider and alias', async () => {
    const { getModelConfig } = await importModule();
    const config = getModelConfig('anthropic', 'sonnet');
    expect(config).toEqual(VALID_CONFIG.providers.anthropic.models.sonnet);
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
    // VALID_CONFIG has sonnet first
    expect(getDefaultModel('anthropic')).toBe('sonnet');
  });

  it("falls back to 'sonnet' for an unknown provider", async () => {
    const { getDefaultModel } = await importModule();
    expect(getDefaultModel('unknown-provider')).toBe('sonnet');
  });
});

describe('getOcProviderID()', () => {
  it('returns ocProviderID when set', async () => {
    const fs = await import('fs');
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        providers: {
          anthropic: {
            label: 'Anthropic',
            ocProviderID: 'opencode-proxy',
            models: {
              sonnet: { label: 'Sonnet', modelID: 'claude-sonnet-4-6', contextWindow: 200000 },
            },
          },
        },
      }),
    );
    const { getOcProviderID } = await importModule();
    expect(getOcProviderID('anthropic')).toBe('opencode-proxy');
  });

  it('falls back to provider key when ocProviderID not set', async () => {
    const { getOcProviderID } = await importModule();
    expect(getOcProviderID('anthropic')).toBe('anthropic');
  });

  it('falls back to providerID for unknown providers', async () => {
    const { getOcProviderID } = await importModule();
    expect(getOcProviderID('unknown')).toBe('unknown');
  });
});

describe('getDefaultProviderID()', () => {
  it('returns the first provider key from config', async () => {
    const { getDefaultProviderID } = await importModule();
    expect(getDefaultProviderID()).toBe('anthropic');
  });

  it('throws when no providers are configured', async () => {
    const fs = await import('fs');
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ providers: {} }));
    const { getDefaultProviderID } = await importModule();
    expect(() => getDefaultProviderID()).toThrow('No providers configured');
  });
});
