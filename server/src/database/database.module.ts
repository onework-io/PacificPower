import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

export const DATABASE = Symbol('DATABASE')
export type Database = PostgresJsDatabase<typeof schema>

@Global()
@Module({
  providers: [{
    provide: DATABASE,
    inject: [ConfigService],
    useFactory: (config: ConfigService): Database => {
      const connectionString = config.get<string>('DATABASE_URL')
      if (!connectionString) throw new Error('DATABASE_URL is required')
      const client = postgres(connectionString, { max: 10, prepare: false })
      return drizzle(client, { schema })
    },
  }],
  exports: [DATABASE],
})
export class DatabaseModule {}
