import { z } from 'zod'
import { createSelectSchema, createInsertSchema } from 'drizzle-zod'
import { cards, projects } from '../server/db/schema'

// ── Entity schemas derived from Drizzle ──────────────────────────────────────

export const cardSchema = createSelectSchema(cards)
export const projectSchema = createSelectSchema(projects)

export type Card = z.infer<typeof cardSchema>
export type Project = z.infer<typeof projectSchema>

// ── Column enum ──────────────────────────────────────────────────────────────

export const columnEnum = z.enum(['backlog', 'ready', 'in_progress', 'review', 'done', 'archive'])
export type Column = z.infer<typeof columnEnum>

// ── Mutation input schemas ───────────────────────────────────────────────────

const cardInsertSchema = createInsertSchema(cards)

export const cardCreateSchema = cardInsertSchema.pick({
  title: true,
  description: true,
  column: true,
  projectId: true,
  model: true,
  thinkingLevel: true,
  useWorktree: true,
  sourceBranch: true,
})

export const cardUpdateSchema = z.object({ id: z.number() }).merge(cardCreateSchema.partial())

export const cardMoveSchema = z.object({
  id: z.number(),
  column: columnEnum,
  position: z.number().optional(),
})

const projectInsertSchema = createInsertSchema(projects)

export const projectCreateSchema = projectInsertSchema.pick({
  name: true,
  path: true,
  setupCommands: true,
  defaultBranch: true,
  defaultWorktree: true,
  defaultModel: true,
  defaultThinkingLevel: true,
  color: true,
})

export const projectUpdateSchema = z.object({ id: z.number() }).merge(projectCreateSchema.partial())

// ── File ref schema ──────────────────────────────────────────────────────────

export const fileRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  path: z.string(),
  size: z.number(),
})

export type FileRef = z.infer<typeof fileRefSchema>

// ── Claude schemas ───────────────────────────────────────────────────────────

export const claudeStartSchema = z.object({
  cardId: z.number(),
  prompt: z.string().min(1),
})

export const claudeSendSchema = z.object({
  cardId: z.number(),
  message: z.string(),
  files: z.array(fileRefSchema).optional(),
})

export const claudeStatusSchema = z.object({
  cardId: z.number(),
  active: z.boolean(),
  status: z.enum(['starting', 'running', 'completed', 'errored', 'stopped']),
  sessionId: z.string().nullable(),
  promptsSent: z.number(),
  turnsCompleted: z.number(),
})

export const claudeMessageSchema = z.object({
  type: z.enum(['user', 'assistant', 'result', 'system']),
  message: z.record(z.string(), z.unknown()),
  isSidechain: z.boolean().optional(),
  ts: z.number().optional(),
})

export type ClaudeStatus = z.infer<typeof claudeStatusSchema>
export type ClaudeMessage = z.infer<typeof claudeMessageSchema>

// ── Client → Server messages ─────────────────────────────────────────────────

export const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), data: z.object({ column: columnEnum.optional() }) }),
  z.object({ type: z.literal('page'), data: z.object({ column: columnEnum, cursor: z.number().optional() }) }),
  z.object({ type: z.literal('search'), data: z.object({ query: z.string(), requestId: z.string() }) }),

  z.object({ type: z.literal('card:create'), data: cardCreateSchema }),
  z.object({ type: z.literal('card:update'), data: cardUpdateSchema }),
  z.object({ type: z.literal('card:move'), data: cardMoveSchema }),
  z.object({ type: z.literal('card:delete'), data: z.object({ id: z.number() }) }),
  z.object({ type: z.literal('card:generateTitle'), data: z.object({ id: z.number() }) }),

  z.object({ type: z.literal('project:create'), data: projectCreateSchema }),
  z.object({ type: z.literal('project:update'), data: projectUpdateSchema }),
  z.object({ type: z.literal('project:delete'), data: z.object({ id: z.number() }) }),
  z.object({ type: z.literal('project:browse'), data: z.object({ path: z.string(), requestId: z.string() }) }),

  z.object({ type: z.literal('claude:start'), data: claudeStartSchema }),
  z.object({ type: z.literal('claude:send'), data: claudeSendSchema }),
  z.object({ type: z.literal('claude:stop'), data: z.object({ cardId: z.number() }) }),
  z.object({ type: z.literal('claude:status'), data: z.object({ cardId: z.number() }) }),

  z.object({ type: z.literal('session:load'), data: z.object({ sessionId: z.string(), cardId: z.number() }) }),
])

export type ClientMessage = z.infer<typeof clientMessage>

// ── Server → Client messages ─────────────────────────────────────────────────

export const serverMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mutation:ok'), data: z.object({ requestId: z.string(), result: z.unknown() }) }),
  z.object({ type: z.literal('mutation:error'), data: z.object({ requestId: z.string(), error: z.string() }) }),

  z.object({ type: z.literal('sync'), data: z.object({ cards: z.array(cardSchema), projects: z.array(projectSchema) }) }),
  z.object({ type: z.literal('card:updated'), data: z.object({ card: cardSchema }) }),
  z.object({ type: z.literal('card:deleted'), data: z.object({ id: z.number() }) }),
  z.object({ type: z.literal('project:updated'), data: z.object({ project: projectSchema }) }),
  z.object({ type: z.literal('project:deleted'), data: z.object({ id: z.number() }) }),

  z.object({ type: z.literal('page:result'), data: z.object({ requestId: z.string(), column: columnEnum, cards: z.array(cardSchema), hasMore: z.boolean() }) }),
  z.object({ type: z.literal('search:result'), data: z.object({ requestId: z.string(), cards: z.array(cardSchema) }) }),

  z.object({ type: z.literal('session:history'), data: z.object({ requestId: z.string().optional(), cardId: z.number(), messages: z.array(claudeMessageSchema) }) }),

  z.object({ type: z.literal('claude:message'), data: claudeMessageSchema }),
  z.object({ type: z.literal('claude:status'), data: claudeStatusSchema }),

  z.object({ type: z.literal('project:browse:result'), data: z.object({ requestId: z.string(), entries: z.array(z.object({ name: z.string(), path: z.string(), isDir: z.boolean() })) }) }),
])

export type ServerMessage = z.infer<typeof serverMessage>
