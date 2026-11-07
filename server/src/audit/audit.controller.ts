import { Controller, Get, Inject, Query, Req } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { RequestWithIdentity } from '../auth/auth.types.js'
import { identityFromRequest } from '../auth/auth.utils.js'
import { AuditLogQueryDto } from './audit.dto.js'
import { AuditService } from './audit.service.js'

@Controller('audit-logs')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: AuditLogQueryDto, @Req() request: FastifyRequest & RequestWithIdentity) {
    return this.audit.list(query, identityFromRequest(request))
  }
}
