import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { financial_settings } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { UpdateFinancialSettingsDto } from "./dto/financial-settings.dto";
import { validateFormula } from "./formula.util";

const SINGLETON = "global";

/**
 * The academy's financial configuration.
 *
 * Read on nearly every financial request — the revenue engine needs the default
 * split, receipts need the number format, the dashboard needs the academic year
 * — so the row is cached in memory and invalidated on write. It changes perhaps
 * a handful of times a year.
 */
@Injectable()
export class FinancialSettingsService {
  private readonly logger = new Logger(FinancialSettingsService.name);
  private cached: financial_settings | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<financial_settings> {
    if (this.cached) return this.cached;

    // The migration seeds this row and a CHECK constraint keeps it unique, so
    // the upsert is belt-and-braces for a database restored from an older dump.
    const settings = await this.prisma.financial_settings.upsert({
      where: { singleton: SINGLETON },
      update: {},
      create: { singleton: SINGLETON },
    });

    this.cached = settings;
    return settings;
  }

  async update(dto: UpdateFinancialSettingsDto, userId: string): Promise<financial_settings> {
    const existing = await this.get();

    if (dto.custom_formula_check) {
      const check = validateFormula(dto.custom_formula_check);
      if (!check.valid) {
        throw new BadRequestException(`Invalid formula: ${check.error}`);
      }
    }

    if (
      dto.default_compensation_model === "custom" &&
      !dto.custom_formula_check &&
      !existing.default_fixed_amount
    ) {
      throw new BadRequestException(
        "A custom default model needs a formula. Set one per professor, or choose another default model.",
      );
    }

    const updated = await this.prisma.financial_settings.update({
      where: { singleton: SINGLETON },
      data: {
        ...(dto.academy_name !== undefined && { academy_name: dto.academy_name }),
        ...(dto.academy_address !== undefined && { academy_address: dto.academy_address }),
        ...(dto.academy_phone !== undefined && { academy_phone: dto.academy_phone }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.currency_locale !== undefined && { currency_locale: dto.currency_locale }),
        ...(dto.default_compensation_model !== undefined && {
          default_compensation_model: dto.default_compensation_model,
        }),
        ...(dto.default_professor_percentage !== undefined && {
          default_professor_percentage: dto.default_professor_percentage,
        }),
        ...(dto.default_fixed_amount !== undefined && {
          default_fixed_amount: dto.default_fixed_amount === null ? null : dto.default_fixed_amount,
        }),
        ...(dto.receipt_number_format !== undefined && {
          receipt_number_format: dto.receipt_number_format,
        }),
        ...(dto.payroll_receipt_format !== undefined && {
          payroll_receipt_format: dto.payroll_receipt_format,
        }),
        ...(dto.settlement_receipt_format !== undefined && {
          settlement_receipt_format: dto.settlement_receipt_format,
        }),
        ...(dto.due_soon_days !== undefined && { due_soon_days: dto.due_soon_days }),
        ...(dto.late_grace_days !== undefined && { late_grace_days: dto.late_grace_days }),
        ...(dto.late_fee_enabled !== undefined && { late_fee_enabled: dto.late_fee_enabled }),
        ...(dto.late_fee_amount !== undefined && {
          late_fee_amount: dto.late_fee_amount === null ? null : dto.late_fee_amount,
        }),
        ...(dto.academic_year_start_month !== undefined && {
          academic_year_start_month: dto.academic_year_start_month,
        }),
      },
    });

    this.cached = updated;

    // A change of split changes what every future collection is worth to a
    // professor, so this is one of the most consequential edits in the product.
    await this.audit.record({
      action: "financial.settings_updated",
      entityType: "financial_settings",
      entityId: null,
      entityLabel: "Financial settings",
      actorId: userId,
      prevValues: this.auditable(existing),
      newValues: this.auditable(updated),
    });

    return updated;
  }

  /** Drops the cache — for tests and for the seed script. */
  invalidate(): void {
    this.cached = null;
  }

  /** The branding controller stores the file and records the path here. */
  async updateLogoPath(logoPath: string | null): Promise<financial_settings> {
    const updated = await this.prisma.financial_settings.update({
      where: { singleton: SINGLETON },
      data: { logo_path: logoPath },
    });
    this.cached = updated;
    return updated;
  }

  private auditable(settings: financial_settings): Record<string, unknown> {
    return {
      academy_name: settings.academy_name,
      academy_address: settings.academy_address,
      academy_phone: settings.academy_phone,
      currency: settings.currency,
      default_compensation_model: settings.default_compensation_model,
      default_professor_percentage: settings.default_professor_percentage.toString(),
      default_fixed_amount: settings.default_fixed_amount?.toString() ?? null,
      receipt_number_format: settings.receipt_number_format,
      payroll_receipt_format: settings.payroll_receipt_format,
      settlement_receipt_format: settings.settlement_receipt_format,
      due_soon_days: settings.due_soon_days,
      late_grace_days: settings.late_grace_days,
      late_fee_enabled: settings.late_fee_enabled,
      late_fee_amount: settings.late_fee_amount?.toString() ?? null,
      academic_year_start_month: settings.academic_year_start_month,
      logo_path: settings.logo_path,
    };
  }
}
