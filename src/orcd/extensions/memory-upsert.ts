import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from '@oh-my-pi/pi-coding-agent';
import type { AgentMessage } from '@oh-my-pi/pi-agent-core';
import type { Message, TextContent } from '@oh-my-pi/pi-ai';
import type { ProviderConfig } from '../config';
import type { ExtensionFactory } from './rolling-window';
import { completeSimple } from '@oh-my-pi/pi-ai';
import { resolveModel } from '../model-registry';

const LOG = '[memory-upsert]';
const MAX_MSG_CHARS = 2000;
const DEFAULT_TURNS_PER_UPSERT = 5;
const DEFAULT_MODEL = 'google/gemma-4-31b';
const DEFAULT_MEMORY_BASE_URL = 'http://localhost:3100';
const DEFAULT_MEMORY_API_KEY = 'SLDVFoD7t+S1WnfnYHb/hEx6xSjd7aFa7Gp6yZVJKp4=';

const EXTRACTION_PROMPT = `You are a memory extraction assistant. Given a conversation excerpt, extract key facts, decisions, patterns, and learnings that would be useful to recall later. For each fact, output a JSON object on its own line with "title" (max 10 words) and "text" (detailed description). Output ONLY valid JSON lines, no other text.`;

export interface MemoryUpsertOptions {
  turnsPerUpsert: number;
  openrouterConfig: ProviderConfig;
  project: string;
  modelId?: string;
  memoryBaseUrl?: string;
  memoryApiKey?: string;
}

interface MemoryFact {
  title: string;
  text: string;
}

/**
 * Store a single memory via the shared-agent-memory REST API.
 */
async function storeMemory(
  baseUrl: string,
  apiKey: string,
  fact: MemoryFact,
  project: string,
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/v1/memories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      title: fact.title,
      text: fact.text,
      project,
      tags: ['auto-upsert'],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable>');
    throw new Error(`Memory API ${res.status}: ${body}`);
  }
}

/**
 * Extract text from a message, truncating to MAX_MSG_CHARS.
 * Only includes user and assistant messages (skips tool results).
 */
function extractText(msg: AgentMessage): string | null {
  const m = msg as Message;
  if (m.role === 'user') {
    const raw = typeof m.content === 'string'
      ? m.content
      : (m.content as Array<{ type: string; text?: string }>)
          .filter(b => b.type === 'text')
          .map(b => b.text ?? '')
          .join('\n');
    return raw.slice(0, MAX_MSG_CHARS);
  }
  if (m.role === 'assistant') {
    const blocks = m.content as Array<{ type: string; text?: string }>;
    const raw = blocks
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('\n');
    return raw.slice(0, MAX_MSG_CHARS);
  }
  return null;
}

/**
 * Build a conversation excerpt from recent session entries.
 */
function buildExcerpt(
  ctx: ExtensionContext,
  recentTurns: number,
): string {
  const entries = ctx.sessionManager.getBranch();
  const messages: AgentMessage[] = [];
  for (const e of entries) {
    if (e.type === 'message') {
      messages.push(e.message);
    }
  }

  // Take the last N*2 messages (each turn ~ 1 user + 1 assistant)
  const tail = messages.slice(-(recentTurns * 2));
  const lines: string[] = [];
  for (const msg of tail) {
    const txt = extractText(msg);
    if (txt) {
      const m = msg as Message;
      lines.push(`[${m.role}]: ${txt}`);
    }
  }
  return lines.join('\n\n');
}

/**
 * Call Gemma 4 31B to extract facts from a conversation excerpt.
 */
async function extractFacts(
  excerpt: string,
  modelId: string,
  openrouterConfig: ProviderConfig,
): Promise<MemoryFact[]> {
  const model = resolveModel(modelId, 'openrouter', openrouterConfig);
  const result = await completeSimple(model, {
    systemPrompt: EXTRACTION_PROMPT,
    messages: [
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: excerpt }],
        timestamp: Date.now(),
      },
    ],
  }, {
    apiKey: openrouterConfig.apiKey,
    maxTokens: 4096,
  });

  const text = result.content
    .filter((b): b is TextContent => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  const facts: MemoryFact[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        typeof parsed === 'object' && parsed !== null &&
        'title' in parsed && 'text' in parsed &&
        typeof (parsed as Record<string, unknown>).title === 'string' &&
        typeof (parsed as Record<string, unknown>).text === 'string'
      ) {
        facts.push(parsed as MemoryFact);
      }
    } catch {
      // skip non-JSON lines
    }
  }
  return facts;
}

/**
 * Run the full upsert pipeline: extract facts then store them.
 * Errors are logged but never thrown.
 */
async function runUpsert(
  ctx: ExtensionContext,
  opts: MemoryUpsertOptions,
  recentTurns: number,
): Promise<void> {
  const excerpt = buildExcerpt(ctx, recentTurns);
  if (!excerpt.trim()) {
    console.error(`${LOG} no messages to extract from, skipping`);
    return;
  }

  const modelId = opts.modelId ?? DEFAULT_MODEL;
  const baseUrl = opts.memoryBaseUrl ?? DEFAULT_MEMORY_BASE_URL;
  const apiKey = opts.memoryApiKey ?? DEFAULT_MEMORY_API_KEY;

  const facts = await extractFacts(excerpt, modelId, opts.openrouterConfig);
  console.error(`${LOG} extracted ${facts.length} facts`);

  const results = await Promise.allSettled(
    facts.map(f => storeMemory(baseUrl, apiKey, f, opts.project)),
  );
  let stored = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      stored++;
    } else {
      console.error(`${LOG} failed to store memory: ${r.reason}`);
    }
  }
  console.error(`${LOG} stored ${stored}/${facts.length} memories`);
}

/**
 * Create a pi extension that extracts and stores memories every N turns.
 *
 * Fires in the background on turn_end — does not block the main agent loop.
 */
export function createMemoryUpsertExtension(opts: MemoryUpsertOptions): ExtensionFactory {
  const interval = opts.turnsPerUpsert || DEFAULT_TURNS_PER_UPSERT;
  let turnCount = 0;

  return (api: ExtensionAPI): void => {
    api.on('turn_end', (_event: TurnEndEvent, ctx: ExtensionContext): void => {
      turnCount++;
      if (turnCount % interval !== 0) return;

      // Fire-and-forget: run upsert in background, never block the agent
      runUpsert(ctx, opts, interval).catch(err => {
        console.error(`${LOG} upsert failed:`, err);
      });
    });
  };
}
