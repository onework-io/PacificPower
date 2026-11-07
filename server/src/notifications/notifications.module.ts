import { Module } from '@nestjs/common'
import { AuthorizationModule } from '../authz/authorization.module.js'
import { NotificationsController } from './notifications.controller.js'
import { NotificationsService } from './notifications.service.js'

@Module({
  imports: [AuthorizationModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
