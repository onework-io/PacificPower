import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { tap } from 'rxjs'
import type { RequestWithIdentity } from '../auth/auth.types.js'
import { LiveEventsService } from './live-events.service.js'

@Injectable()
export class MutationEventsInterceptor implements NestInterceptor {
  constructor(@Inject(LiveEventsService) private readonly events: LiveEventsService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<FastifyRequest & RequestWithIdentity>()
    const method = request.method.toUpperCase()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next.handle()
    return next.handle().pipe(tap(() => {
      const identity = request.pacificpowerIdentity
      if (!identity) return
      const params = request.params as Record<string, unknown> | undefined
      const body = request.body as Record<string, unknown> | undefined
      const projectId = this.stringValue(params?.projectId) ?? this.stringValue(body?.projectId) ?? null
      const path = request.url.split('?')[0] ?? request.url
      this.events.publish({
        type: this.eventType(path),
        organizationId: identity.organizationId,
        projectId,
        actorUserId: identity.userId ?? null,
        resource: this.resource(path),
        method,
        path,
        requestId: identity.requestId,
      })
    }))
  }

  private stringValue(value: unknown) {
    return typeof value === 'string' && value ? value : undefined
  }

  private eventType(path: string) {
    if (path.includes('/daily-reports')) return 'daily-report.changed'
    if (path.includes('/labor-entries')) return 'labor.changed'
    if (path.includes('/crew-dispatches')) return 'dispatch.changed'
    if (path.includes('/documents')) return 'document.changed'
    if (path.includes('/pois')) return 'poi.changed'
    if (path.includes('/models')) return 'model.changed'
    if (path.includes('/wbs/') || path.includes('/tasks')) return 'wbs.changed'
    if (path.includes('/accounts')) return 'account.changed'
    if (path.includes('/crews')) return 'crew.changed'
    if (path.includes('/projects')) return 'project.changed'
    return 'resource.changed'
  }

  private resource(path: string) {
    return this.eventType(path).replace('.changed', '')
  }
}
