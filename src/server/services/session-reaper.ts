import { Card } from '../models/Card'
import { sessionManager } from '../agents/manager'

const IDLE_MS = 5 * 60 * 1000
const POLL_MS = 60 * 1000

export function startSessionReaper(): void {
  setInterval(async () => {
    try {
      const cards = await Card.find({ where: { column: 'review' as const } })
      const now = Date.now()
      for (const card of cards) {
        const session = sessionManager.get(card.id)
        if (!session) continue
        const age = now - new Date(card.updatedAt).getTime()
        if (age < IDLE_MS) continue
        console.log(`[reaper] killing idle session for card ${card.id} (idle ${Math.round(age / 1000)}s)`)
        sessionManager.requestStop(card.id)
      }
    } catch (err) {
      console.error('[reaper] error:', err)
    }
  }, POLL_MS)
}
