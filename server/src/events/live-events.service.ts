import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'

export interface LiveEvent {
  id: string
  type: string
  organizationId: string
  projectId: string | null
  actorUserId: string | null
  resource: string
  method: string
  path: string
  requestId: string
  occurredAt: string
}

interface Subscriber {
  organizationId: string
  projectId: string | null
  send: (event: LiveEvent) => void
}

@Injectable()
export class LiveEventsService {
  private readonly subscribers = new Map<string, Subscriber>()

  subscribe(subscriber: Subscriber) {
    const id = randomUUID()
    this.subscribers.set(id, subscriber)
    return () => this.subscribers.delete(id)
  }

  publish(event: Omit<LiveEvent, 'id' | 'occurredAt'>) {
    const complete: LiveEvent = { ...event, id: randomUUID(), occurredAt: new Date().toISOString() }
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.organizationId !== complete.organizationId) continue
      if (subscriber.projectId && subscriber.projectId !== complete.projectId) continue
      try { subscriber.send(complete) } catch { /* closed streams are removed by the close handler */ }
    }
  }

  subscriberCount(organizationId?: string) {
    if (!organizationId) return this.subscribers.size
    return [...this.subscribers.values()].filter((subscriber) => subscriber.organizationId === organizationId).length
  }
}
