import { IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * The serialized Excalidraw scene (the JSON-schema document produced by
 * `serializeAsJSON`): `{ type, version, source, elements, appState, files }`.
 * Stored as-is in a `jsonb` column so a saved board reopens fully editable.
 */
export class CreateWhiteboardDto {
  @ApiPropertyOptional({ description: "Titre du tableau. Par défaut : « Nouveau tableau »." })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiProperty({ description: "Scène Excalidraw sérialisée (éléments, appState, fichiers)." })
  @IsObject()
  scene!: Record<string, unknown>;
}

export class UpdateWhiteboardDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  scene?: Record<string, unknown>;
}