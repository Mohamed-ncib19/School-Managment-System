import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength, ArrayMinSize, ArrayMaxSize, Validate } from "class-validator";

const VALID_ENTITIES = ["level", "field", "professor", "group", "student"] as const;
type ValidEntity = (typeof VALID_ENTITIES)[number];

class EntityOrderValidator {
  validate(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    if (value.length < 2 || value.length > 5) return false;
    const unique = new Set(value);
    if (unique.size !== value.length) return false;
    return value.every((v) => VALID_ENTITIES.includes(v as ValidEntity));
  }

  defaultMessage(): string {
    return `entityOrder must be an array of 2-5 unique entities from: ${VALID_ENTITIES.join(", ")}`;
  }
}

export class CreateHierarchyConfigDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(5)
  @Validate(EntityOrderValidator)
  entityOrder!: ValidEntity[];
}

export class UpdateHierarchyConfigDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(5)
  @Validate(EntityOrderValidator)
  entityOrder?: ValidEntity[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
