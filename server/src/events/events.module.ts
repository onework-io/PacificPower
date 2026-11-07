import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { AuthorizationModule } from '../authz/authorization.module.js'
import { LiveEventsController } from './live-events.controller.js'
import { LiveEventsService } from './live-events.service.js'
import { MutationEventsInterceptor } from './mutation-events.interceptor.js'

@Module({
  imports: [AuthorizationModule],
  controllers: [LiveEventsController],
  providers: [
    LiveEventsService,
    { provide: APP_INTERCEPTOR, useClass: MutationEventsInterceptor },
  ],
  exports: [LiveEventsService],
})
export class EventsModule {}
