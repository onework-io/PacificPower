import { Body, Controller, Get, Inject, Put, Req } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { RequestWithIdentity } from '../auth/auth.types.js'
import { identityFromRequest } from '../auth/auth.utils.js'
import { UpdateNotificationPreferencesDto, UpdateNotificationReadStateDto } from './notification.dto.js'
import { NotificationsService } from './notifications.service.js'

@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get('read-state')
  list(@Req() request: FastifyRequest & RequestWithIdentity) {
    return this.notifications.listReadState(identityFromRequest(request))
  }

  @Put('read-state')
  update(@Body() dto: UpdateNotificationReadStateDto, @Req() request: FastifyRequest & RequestWithIdentity) {
    return this.notifications.updateReadState(dto, identityFromRequest(request))
  }

  @Get('preferences')
  preferences(@Req() request: FastifyRequest & RequestWithIdentity) {
    return this.notifications.getPreferences(identityFromRequest(request))
  }

  @Put('preferences')
  updatePreferences(@Body() dto: UpdateNotificationPreferencesDto, @Req() request: FastifyRequest & RequestWithIdentity) {
    return this.notifications.updatePreferences(dto, identityFromRequest(request))
  }
}
