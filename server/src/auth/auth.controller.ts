import { Controller, Get, Inject, Req } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { AuthService } from './auth.service.js'
import type { RequestWithIdentity } from './auth.types.js'
import { identityFromRequest } from './auth.utils.js'

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get('me')
  me(@Req() request: FastifyRequest & RequestWithIdentity) {
    return this.auth.profile(identityFromRequest(request))
  }
}
