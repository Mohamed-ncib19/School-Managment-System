import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ENTITY_COLOR_PATTERN, ENTITY_COLOR_MESSAGE } from "../../common/color.util";

export class CreateClassroomDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  floor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  room_number?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  equipment?: string[];

  @ApiPropertyOptional({ example: "#4F46E5" })
  @IsOptional()
  @Matches(ENTITY_COLOR_PATTERN, { message: ENTITY_COLOR_MESSAGE })
  color?: string;
}

export class UpdateClassroomDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  floor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  room_number?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  equipment?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ example: "#4F46E5" })
  @IsOptional()
  @Matches(ENTITY_COLOR_PATTERN, { message: ENTITY_COLOR_MESSAGE })
  color?: string;
}
