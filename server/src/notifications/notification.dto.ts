import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsString, MaxLength } from 'class-validator'

export class UpdateNotificationReadStateDto {
  @IsArray()
  @ArrayMaxSize(250)
  @IsString({ each: true })
  @MaxLength(240, { each: true })
  keys!: string[]

  @IsBoolean()
  read!: boolean
}

export class UpdateNotificationPreferencesDto {
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(['daily', 'labor', 'dispatch', 'qualification'], { each: true })
  enabledTypes!: string[]

  @IsIn(['info', 'warning', 'critical'])
  minimumSeverity!: 'info' | 'warning' | 'critical'

  @IsBoolean()
  realtimeEnabled!: boolean
}
