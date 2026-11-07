import { BadRequestException, Controller, Get, Inject, Query, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { RequestWithIdentity } from '../auth/auth.types.js'
import { identityFromRequest } from '../auth/auth.utils.js'
import { AuthorizationService } from '../authz/authorization.service.js'
import { LiveEventsService, type LiveEvent } from './live-events.service.js'

@Controller('events')
export class LiveEventsController {
  constructor(
    @Inject(LiveEventsService) private readonly events: LiveEventsService,
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Get('stream')
  async stream(
    @Query('projectId') projectId: string | undefined,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res() reply: FastifyReply,
  ) {
    if (projectId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
      throw new BadRequestException('projectId must be a UUID')
    }
    const identity = identityFromRequest(request)
    await this.authz.assert(identity, projectId ? 'project.view' : 'report.portfolio.view', projectId)

    reply.hijack()
    const origin = request.headers.origin
    const allowedOrigins = this.config.get<string>('CORS_ORIGIN', 'http://127.0.0.1:5173')
      .split(',').map((value) => value.trim())
    const corsHeaders = typeof origin === 'string' && allowedOrigins.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' }
      : {}
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...corsHeaders,
    })
    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString(), projectId: projectId ?? null })}\n\n`)

    const send = (event: LiveEvent) => {
      reply.raw.write(`id: ${event.id}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`)
    }
    const unsubscribe = this.events.subscribe({
      organizationId: identity.organizationId,
      projectId: projectId ?? null,
      send,
    })
    const heartbeat = setInterval(() => reply.raw.write(`: heartbeat ${Date.now()}\n\n`), 15_000)
    try {
      // Keep Nest/Fastify from finalizing the hijacked response while the
      // browser remains subscribed.
      await new Promise<void>((resolve) => reply.raw.once('close', resolve))
    } finally {
      clearInterval(heartbeat)
      unsubscribe()
    }
  }
}
