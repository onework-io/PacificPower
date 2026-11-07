import { Module } from '@nestjs/common'
import { AuthorizationModule } from '../authz/authorization.module.js'
import { EventsModule } from '../events/events.module.js'
import { SystemController } from './system.controller.js'
import { SystemService } from './system.service.js'

@Module({
  imports: [AuthorizationModule, EventsModule],
  controllers: [SystemController],
  providers: [SystemService],
})
export class SystemModule {}
