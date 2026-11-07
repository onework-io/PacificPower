import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, IsUUID,
  Length, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator'

const trimmed = () => Transform(({ value }) => typeof value === 'string' ? value.trim() : value)

export class ApplyModelTemplateDto {
  @trimmed() @IsString() @Length(1, 80)
  templateCode!: string
}

export class ModelPartMappingDto {
  @IsUUID()
  partId!: string

  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  taskId!: string | null
}

export class ReplaceModelPartMappingsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ModelPartMappingDto)
  mappings!: ModelPartMappingDto[]
}

export class CreatePoiDto {
  @trimmed() @IsString() @Length(1, 120)
  partKey!: string

  @IsArray() @ArrayMinSize(3) @ArrayMaxSize(3) @IsNumber({}, { each: true })
  position!: [number, number, number]

  @trimmed() @IsString() @Length(1, 160)
  title!: string

  @trimmed() @IsString() @MaxLength(2000)
  url = ''

  @IsOptional() @IsInt() @Min(0) @Max(86400)
  startSec?: number

  @IsOptional() @IsInt() @Min(1) @Max(86400)
  endSec?: number

  @trimmed() @IsOptional() @IsString() @MaxLength(4000)
  note?: string
}

export class UpdatePoiDto {
  @trimmed() @IsOptional() @IsString() @Length(1, 120)
  partKey?: string

  @IsOptional() @IsArray() @ArrayMinSize(3) @ArrayMaxSize(3) @IsNumber({}, { each: true })
  position?: [number, number, number]

  @trimmed() @IsOptional() @IsString() @Length(1, 160)
  title?: string

  @trimmed() @IsOptional() @IsString() @MaxLength(2000)
  url?: string

  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsInt() @Min(0) @Max(86400)
  startSec?: number | null

  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsInt() @Min(1) @Max(86400)
  endSec?: number | null

  @trimmed() @IsOptional() @IsString() @MaxLength(4000)
  note?: string
}
