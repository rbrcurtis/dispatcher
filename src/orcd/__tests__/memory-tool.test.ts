import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentTool } from '@oh-my-pi/pi-agent-core';
import {
  createMemoryTools,
  memoryFetch,
  type MemoryConfig,
} from '../tools/memory';

// ─── helpers ──────────────────────────────────────────────────────────────────

const TEST_CONFIG: MemoryConfig = {
  baseUrl: 'http://localhost:3100',
  apiKey: 'test-key-123',
};

function mockFetchOk(body: unknown): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

function mockFetchError(status: number, statusText: string): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    text: () => Promise.resolve(`${status} ${statusText}`),
  });
}

function mockFetchNetworkError(): typeof globalThis.fetch {
  return vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
}

// ─── tool shape tests ────────────────────────────────────────────────────────

describe('createMemoryTools', () => {
  let tools: AgentTool[];

  beforeEach(() => {
    tools = createMemoryTools(TEST_CONFIG);
  });

  it('returns four tools', () => {
    expect(tools).toHaveLength(4);
  });

  it.each([
    ['search_memory', 'Search Memory'],
    ['store_memory', 'Store Memory'],
    ['update_memory', 'Update Memory'],
    ['load_memories', 'Load Memories'],
  ])('tool "%s" has correct AgentTool shape', (name, label) => {
    const tool = tools.find(t => t.name === name);
    expect(tool).toBeDefined();
    expect(tool!.name).toBe(name);
    expect(tool!.label).toBe(label);
    expect(typeof tool!.description).toBe('string');
    expect(tool!.description.length).toBeGreaterThan(0);
    expect(tool!.parameters).toBeDefined();
    expect(typeof tool!.execute).toBe('function');
  });
});

// ─── memoryFetch tests ───────────────────────────────────────────────────────

describe('memoryFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('makes GET request with correct auth header and query params', async () => {
    const stub = mockFetchOk({ data: [] });
    vi.stubGlobal('fetch', stub);

    await memoryFetch(TEST_CONFIG, '/api/v1/memories/search', {
      method: 'GET',
      params: { query: 'test', limit: '5' },
    });

    expect(stub).toHaveBeenCalledOnce();
    const [url, opts] = (stub as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3100/api/v1/memories/search?query=test&limit=5');
    expect(opts.headers).toEqual(expect.objectContaining({
      Authorization: 'Bearer test-key-123',
    }));
  });

  it('makes POST request with JSON body', async () => {
    const stub = mockFetchOk({ data: { id: '42' } });
    vi.stubGlobal('fetch', stub);

    await memoryFetch(TEST_CONFIG, '/api/v1/memories', {
      method: 'POST',
      body: { title: 'test', text: 'content' },
    });

    const [, opts] = (stub as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual(expect.objectContaining({
      'Content-Type': 'application/json',
    }));
    expect(JSON.parse(opts.body as string)).toEqual({ title: 'test', text: 'content' });
  });

  it('makes PUT request with JSON body', async () => {
    const stub = mockFetchOk({ data: { success: true } });
    vi.stubGlobal('fetch', stub);

    await memoryFetch(TEST_CONFIG, '/api/v1/memories/42', {
      method: 'PUT',
      body: { title: 'updated', text: 'new content' },
    });

    const [url, opts] = (stub as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3100/api/v1/memories/42');
    expect(opts.method).toBe('PUT');
  });

  it('throws on non-200 response', async () => {
    vi.stubGlobal('fetch', mockFetchError(500, 'Internal Server Error'));

    await expect(
      memoryFetch(TEST_CONFIG, '/api/v1/memories/search', { method: 'GET' }),
    ).rejects.toThrow('Memory API error 500');
  });

  it('throws on network error', async () => {
    vi.stubGlobal('fetch', mockFetchNetworkError());

    await expect(
      memoryFetch(TEST_CONFIG, '/api/v1/memories/search', { method: 'GET' }),
    ).rejects.toThrow('ECONNREFUSED');
  });
});

// ─── tool execution tests ────────────────────────────────────────────────────

describe('search_memory execute', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns search results as text content', async () => {
    vi.stubGlobal('fetch', mockFetchOk({
      data: [
        { id: '1', title: 'First memory', score: 0.95 },
        { id: '2', title: 'Second memory', score: 0.8 },
      ],
    }));

    const tools = createMemoryTools(TEST_CONFIG);
    const tool = tools.find(t => t.name === 'search_memory')!;
    const result = await tool.execute.call(tool, 'tc-1', { query: 'test', limit: 5 });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('First memory');
    expect(text).toContain('Second memory');
  });

  it('handles empty search results', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ data: [] }));

    const tools = createMemoryTools(TEST_CONFIG);
    const tool = tools.find(t => t.name === 'search_memory')!;
    const result = await tool.execute.call(tool, 'tc-1', { query: 'nothing' });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('No memories found');
  });

  it('returns error content on fetch failure', async () => {
    vi.stubGlobal('fetch', mockFetchError(500, 'Internal Server Error'));

    const tools = createMemoryTools(TEST_CONFIG);
    const tool = tools.find(t => t.name === 'search_memory')!;
    const result = await tool.execute.call(tool, 'tc-1', { query: 'test' });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Error');
  });
});

describe('store_memory execute', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('stores memory and returns id', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ data: { id: '42' } }));

    const tools = createMemoryTools(TEST_CONFIG);
    const tool = tools.find(t => t.name === 'store_memory')!;
    const result = await tool.execute.call(tool, 'tc-1', {
      title: 'Test memory',
      text: 'Some content',
      project: 'orchestrel',
      tags: ['test'],
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('42');
  });
});

describe('update_memory execute', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('updates memory and returns success', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ data: { success: true } }));

    const tools = createMemoryTools(TEST_CONFIG);
    const tool = tools.find(t => t.name === 'update_memory')!;
    const result = await tool.execute.call(tool, 'tc-1', {
      id: '42',
      title: 'Updated title',
      text: 'Updated content',
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Updated memory 42');
  });
});

describe('load_memories execute', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads memories by IDs', async () => {
    vi.stubGlobal('fetch', mockFetchOk({
      data: [
        { id: '1', title: 'First', text: 'Content one' },
        { id: '2', title: 'Second', text: 'Content two' },
      ],
    }));

    const tools = createMemoryTools(TEST_CONFIG);
    const tool = tools.find(t => t.name === 'load_memories')!;
    const result = await tool.execute.call(tool, 'tc-1', { ids: ['1', '2'] });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('First');
    expect(text).toContain('Content one');
    expect(text).toContain('Second');
    expect(text).toContain('Content two');
  });

  it('passes project parameter when provided', async () => {
    const stub = mockFetchOk({ data: [] });
    vi.stubGlobal('fetch', stub);

    const tools = createMemoryTools(TEST_CONFIG);
    const tool = tools.find(t => t.name === 'load_memories')!;
    await tool.execute.call(tool, 'tc-1', { ids: ['1'], project: 'myproject' });

    const [url] = (stub as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('project=myproject');
  });
});
