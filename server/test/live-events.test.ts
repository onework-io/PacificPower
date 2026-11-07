import { describe, expect, it, vi } from 'vitest'
import { LiveEventsService } from '../src/events/live-events.service.js'

const baseEvent = {
  type: 'wbs.changed',
  organizationId: 'org-a',
  projectId: 'project-a',
  actorUserId: 'user-a',
  resource: 'wbs',
  method: 'PATCH',
  path: '/projects/project-a/wbs/items/item-a',
  requestId: 'request-a',
}

describe('LiveEventsService', () => {
  it('only broadcasts to matching organizations and project subscriptions', () => {
    const service = new LiveEventsService()
    const matching = vi.fn()
    const otherProject = vi.fn()
    const otherOrganization = vi.fn()
    service.subscribe({ organizationId: 'org-a', projectId: 'project-a', send: matching })
    service.subscribe({ organizationId: 'org-a', projectId: 'project-b', send: otherProject })
    service.subscribe({ organizationId: 'org-b', projectId: null, send: otherOrganization })

    service.publish(baseEvent)

    expect(matching).toHaveBeenCalledOnce()
    expect(matching.mock.calls[0]?.[0]).toMatchObject(baseEvent)
    expect(matching.mock.calls[0]?.[0].id).toEqual(expect.any(String))
    expect(matching.mock.calls[0]?.[0].occurredAt).toEqual(expect.any(String))
    expect(otherProject).not.toHaveBeenCalled()
    expect(otherOrganization).not.toHaveBeenCalled()
    expect(service.subscriberCount('org-a')).toBe(2)
    expect(service.subscriberCount()).toBe(3)
  })

  it('broadcasts every project to an organization-wide subscriber and supports unsubscribe', () => {
    const service = new LiveEventsService()
    const send = vi.fn()
    const unsubscribe = service.subscribe({ organizationId: 'org-a', projectId: null, send })

    service.publish(baseEvent)
    unsubscribe()
    service.publish({ ...baseEvent, projectId: 'project-b' })

    expect(send).toHaveBeenCalledOnce()
    expect(service.subscriberCount('org-a')).toBe(0)
  })
})
