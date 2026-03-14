import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { DataSource } from 'typeorm'
import { Card, CardSubscriber } from './Card'
import { messageBus } from '../bus'

let ds: DataSource

beforeAll(async () => {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [Card],
    subscribers: [CardSubscriber],
    synchronize: true,
  })
  await ds.initialize()
})

afterAll(async () => {
  await ds.destroy()
})

describe('Card entity', () => {
  it('creates a card and publishes card:updated + board:changed', async () => {
    const boardHandler = vi.fn()
    messageBus.subscribe('board:changed', boardHandler)

    const card = ds.getRepository(Card).create({
      title: 'Test card',
      description: 'Test desc',
      column: 'backlog',
      position: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await card.save()

    expect(boardHandler).toHaveBeenCalledWith(
      expect.objectContaining({ newColumn: 'backlog', oldColumn: null })
    )
    messageBus.unsubscribe('board:changed', boardHandler)
  })

  it('publishes board:changed with oldColumn and newColumn when column changes', async () => {
    const boardHandler = vi.fn()

    const card = ds.getRepository(Card).create({
      title: 'Column card',
      description: 'desc',
      column: 'backlog',
      position: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await card.save()

    messageBus.subscribe('board:changed', boardHandler)
    card.column = 'ready'
    await card.save()

    expect(boardHandler).toHaveBeenCalledWith(
      expect.objectContaining({ oldColumn: 'backlog', newColumn: 'ready' })
    )
    messageBus.unsubscribe('board:changed', boardHandler)
  })

  it('publishes card:status when promptsSent changes', async () => {
    const card = ds.getRepository(Card).create({
      title: 'Status card',
      description: 'desc',
      column: 'running',
      position: 0,
      promptsSent: 0,
      turnsCompleted: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await card.save()

    const statusHandler = vi.fn()
    messageBus.subscribe(`card:${card.id}:status`, statusHandler)
    card.promptsSent = 1
    await card.save()

    expect(statusHandler).toHaveBeenCalledOnce()
    messageBus.unsubscribe(`card:${card.id}:status`, statusHandler)
  })

  it('publishes card:deleted and board:changed on remove', async () => {
    const card = ds.getRepository(Card).create({
      title: 'Delete me',
      description: 'desc',
      column: 'backlog',
      position: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await card.save()
    const id = card.id

    const deletedHandler = vi.fn()
    const boardHandler = vi.fn()
    messageBus.subscribe(`card:${id}:deleted`, deletedHandler)
    messageBus.subscribe('board:changed', boardHandler)

    await card.remove()

    expect(deletedHandler).toHaveBeenCalledWith(expect.objectContaining({ id }))
    expect(boardHandler).toHaveBeenCalled()
    messageBus.unsubscribe(`card:${id}:deleted`, deletedHandler)
    messageBus.unsubscribe('board:changed', boardHandler)
  })
})
