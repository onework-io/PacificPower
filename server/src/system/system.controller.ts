import { Controller, Get, Inject, Req } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { RequestWithIdentity } from '../auth/auth.types.js'
import { identityFromRequest } from '../auth/auth.utils.js'
import { SystemService } from './system.service.js'

@Controller('system')
export class SystemController {
  constructor(@Inject(SystemService) private readonly system: SystemService) {}

  @Get('status')
  status(@Req() request: FastifyRequest & RequestWithIdentity) {
    return this.system.status(identityFromRequest(request))
  }
}
