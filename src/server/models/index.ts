import { DataSource } from 'typeorm'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { Card, CardSubscriber } from './Card'

const DB_DIR = join(process.cwd(), 'data')
mkdirSync(DB_DIR, { recursive: true })

export const AppDataSource = new DataSource({
  type: 'better-sqlite3',
  database: join(DB_DIR, 'dispatcher.db'),
  entities: [Card],
  subscribers: [CardSubscriber],
  synchronize: false,
})

export async function initDatabase(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize()
    console.log('[db] TypeORM DataSource initialized')
  }
}
