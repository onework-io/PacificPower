import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { DatabaseModule } from './database/database.module.js'
import { ProjectsModule } from './projects/projects.module.js'
import { AccountsModule } from './accounts/accounts.module.js'
import { AuthorizationModule } from './authz/authorization.module.js'
import { AuthModule } from './auth/auth.module.js'
import { WbsModule } from './wbs/wbs.module.js'
import { ModelsModule } from './models/models.module.js'
import { StorageModule } from './storage/storage.module.js'
import { AuditModule } from './audit/audit.module.js'
import { EventsModule } from './events/events.module.js'
import { SystemModule } from './system/system.module.js'
import { NotificationsModule } from './notifications/notifications.module.js'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env'] }),
    DatabaseModule,
    AuthModule,
    AuthorizationModule,
    ProjectsModule,
    WbsModule,
    ModelsModule,
    StorageModule,
    AccountsModule,
    AuditModule,
    EventsModule,
    SystemModule,
    NotificationsModule,
  ],
})
export class AppModule {}
