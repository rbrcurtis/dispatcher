import type { AgentTool, AgentToolResult } from '@oh-my-pi/pi-agent-core';
import { Type, type TObject } from '@sinclair/typebox';

// ─── config ──────────────────────────────────────────────────────────────────

export interface MemoryConfig {
  baseUrl: string;
  apiKey: string;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  baseUrl: 'http://localhost:3100',
  apiKey: 'SLDVFoD7t+S1WnfnYHb/hEx6xSjd7aFa7Gp6yZVJKp4=',
};

// ─── shared fetch helper ─────────────────────────────────────────────────────

interface FetchOpts {
  method: 'GET' | 'POST' | 'PUT';
  params?: Record<string, string>;
  body?: Record<string, unknown>;
}

export async function memoryFetch(
  cfg: MemoryConfig,
  path: string,
  opts: FetchOpts,
): Promise<unknown> {
  let url = `${cfg.baseUrl}${path}`;

  if (opts.params) {
    const sp = new URLSearchParams(opts.params);
    url += `?${sp.toString()}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
  };

  let reqBody: string | undefined;
  if (opts.body) {
    headers['Content-Type'] = 'application/json';
    reqBody = JSON.stringify(opts.body);
  }

  const res = await fetch(url, {
    method: opts.method,
    headers,
    body: reqBody,
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Memory API error ${res.status}: ${msg}`);
  }

  return res.json();
}

// ─── result helpers ──────────────────────────────────────────────────────────

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(err: unknown): AgentToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  return textResult(`Error: ${msg}`);
}

// ─── tool definitions ────────────────────────────────────────────────────────

interface SearchMemoryParams {
  query: string;
  project?: string;
  limit?: number;
}

interface SearchResult {
  id: string;
  title: string;
  score: number;
}

function createSearchMemoryTool(cfg: MemoryConfig): AgentTool<TObject> {
  return {
    name: 'search_memory',
    label: 'Search Memory',
    description:
      'Search shared agent memory by semantic similarity. Returns memory titles, IDs, and relevance scores. Use load_memories to retrieve full text.',
    parameters: Type.Object({
      query: Type.String({ description: 'Semantic search query' }),
      project: Type.Optional(Type.String({ description: 'Filter by project name' })),
      limit: Type.Optional(Type.Number({ description: 'Max results (default 10)' })),
    }),
    async execute(_toolCallId, params: SearchMemoryParams): Promise<AgentToolResult> {
      try {
        const p: Record<string, string> = { query: params.query };
        if (params.project) p.project = params.project;
        if (params.limit != null) p.limit = String(params.limit);

        const res = await memoryFetch(cfg, '/api/v1/memories/search', {
          method: 'GET',
          params: p,
        });

        const data = (res as { data: SearchResult[] }).data;
        if (!data || data.length === 0) {
          return textResult('No memories found matching the query.');
        }

        const lines = data.map(
          (m) => `- [${m.id}] ${m.title} (score: ${m.score.toFixed(2)})`,
        );
        return textResult(`Found ${data.length} memories:\n${lines.join('\n')}`);
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

interface StoreMemoryParams {
  title: string;
  text: string;
  project?: string;
  tags?: string[];
}

function createStoreMemoryTool(cfg: MemoryConfig): AgentTool<TObject> {
  return {
    name: 'store_memory',
    label: 'Store Memory',
    description:
      'Store a new memory in shared agent memory. One concept per memory with a descriptive title for semantic search.',
    parameters: Type.Object({
      title: Type.String({ description: 'Short descriptive title for semantic search' }),
      text: Type.String({ description: 'Full memory content' }),
      project: Type.Optional(Type.String({ description: 'Project name to associate with' })),
      tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for categorization' })),
    }),
    async execute(_toolCallId, params: StoreMemoryParams): Promise<AgentToolResult> {
      try {
        const body: Record<string, unknown> = {
          title: params.title,
          text: params.text,
        };
        if (params.project) body.project = params.project;
        if (params.tags) body.tags = params.tags;

        const res = await memoryFetch(cfg, '/api/v1/memories', {
          method: 'POST',
          body,
        });

        const id = (res as { data: { id: string } }).data.id;
        return textResult(`Stored memory with id: ${id}`);
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

interface UpdateMemoryParams {
  id: string;
  title?: string;
  text?: string;
}

function createUpdateMemoryTool(cfg: MemoryConfig): AgentTool<TObject> {
  return {
    name: 'update_memory',
    label: 'Update Memory',
    description:
      'Update an existing memory by ID. Provide new title and/or text to replace.',
    parameters: Type.Object({
      id: Type.String({ description: 'Memory ID to update' }),
      title: Type.Optional(Type.String({ description: 'New title' })),
      text: Type.Optional(Type.String({ description: 'New text content' })),
    }),
    async execute(_toolCallId, params: UpdateMemoryParams): Promise<AgentToolResult> {
      try {
        const body: Record<string, unknown> = {};
        if (params.title != null) body.title = params.title;
        if (params.text != null) body.text = params.text;

        await memoryFetch(cfg, `/api/v1/memories/${params.id}`, {
          method: 'PUT',
          body,
        });

        return textResult(`Updated memory ${params.id} successfully.`);
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

interface LoadMemoriesParams {
  ids: string[];
  project?: string;
}

interface LoadedMemory {
  id: string;
  title: string;
  text: string;
  [key: string]: unknown;
}

function createLoadMemoriesTool(cfg: MemoryConfig): AgentTool<TObject> {
  return {
    name: 'load_memories',
    label: 'Load Memories',
    description:
      'Load full memory text by IDs. Use after search_memory to retrieve complete content.',
    parameters: Type.Object({
      ids: Type.Array(Type.String(), { description: 'Memory IDs to load' }),
      project: Type.Optional(Type.String({ description: 'Project context for loading' })),
    }),
    async execute(_toolCallId, params: LoadMemoriesParams): Promise<AgentToolResult> {
      try {
        const p: Record<string, string> = {
          ids: params.ids.join(','),
        };
        if (params.project) p.project = params.project;

        const res = await memoryFetch(cfg, '/api/v1/memories/load', {
          method: 'GET',
          params: p,
        });

        const data = (res as { data: LoadedMemory[] }).data;
        if (!data || data.length === 0) {
          return textResult('No memories found for the given IDs.');
        }

        const sections = data.map(
          (m) => `## ${m.title} [${m.id}]\n${m.text}`,
        );
        return textResult(sections.join('\n\n'));
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

// ─── public API ──────────────────────────────────────────────────────────────

export function createMemoryTools(cfg: MemoryConfig = DEFAULT_MEMORY_CONFIG): AgentTool[] {
  return [
    createSearchMemoryTool(cfg),
    createStoreMemoryTool(cfg),
    createUpdateMemoryTool(cfg),
    createLoadMemoriesTool(cfg),
  ];
}
