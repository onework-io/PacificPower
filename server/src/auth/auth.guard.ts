import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { AuthService } from './auth.service.js'
import type { RequestWithIdentity } from './auth.types.js'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest & RequestWithIdentity>()
    const requestId = String(request.headers['x-request-id'] ?? request.id)
    request.pacificpowerIdentity = await this.auth.authenticate(request, requestId)
    return true
  }
}
