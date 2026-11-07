import { Transform } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator'

const trimmed = () => Transform(({ value }) => typeof value === 'string' ? value.trim() : value)

export class PrepareCoverUploadDto {
  @trimmed() @IsString() @Length(1, 180)
  fileName!: string

  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  mimeType!: string

  @IsInt() @Min(1) @Max(10 * 1024 * 1024)
  byteSize!: number

  @IsOptional() @IsString() @Matches(/^[a-f0-9]{64}$/i)
  sha256?: string
}

export class CompleteCoverUploadDto {
  @IsString() @Matches(/^[0-9a-f-]{36}$/i)
  fileId!: string
}

const documentCategories = ['drawing', 'contract', 'inspection', 'manual', 'photo', 'model', 'other'] as const

export class PrepareProjectDocumentDto {
  @trimmed() @IsString() @Length(1, 180)
  fileName!: string

  @trimmed() @IsString() @Length(1, 180)
  mimeType!: string

  @IsInt() @Min(1) @Max(200 * 1024 * 1024)
  byteSize!: number

  @IsOptional() @IsString() @Matches(/^[a-f0-9]{64}$/i)
  sha256?: string
}

export class CompleteProjectDocumentDto extends CompleteCoverUploadDto {
  @trimmed() @IsString() @Length(1, 180)
  title!: string

  @IsIn(documentCategories)
  category!: typeof documentCategories[number]

  @IsOptional() @trimmed() @IsString() @MaxLength(2000)
  description?: string
}

export class UpdateProjectDocumentDto {
  @IsOptional() @trimmed() @IsString() @Length(1, 180)
  title?: string

  @IsOptional() @IsIn(documentCategories)
  category?: typeof documentCategories[number]

  @IsOptional() @trimmed() @IsString() @MaxLength(2000)
  description?: string

  @IsOptional() @IsIn(['active', 'archived'])
  status?: 'active' | 'archived'
}
