import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { FinancialController } from "./financial.controller";
import { BrandingController } from "./branding.controller";
import { FinancialService } from "./financial.service";
import { FinancialSettingsService } from "./financial-settings.service";
import { RevenueCalculationService } from "./revenue-calculation.service";
import { ReceiptNumberService } from "./receipt-number.service";
import { PaymentService } from "./payment.service";
import { PayrollService } from "./payroll.service";
import { PayrollDocumentService } from "./payroll-document.service";
import { AnalyticsService } from "./analytics.service";
import { FinancialReportService } from "./financial-report.service";
import { FinancialExportService } from "./financial-export.service";
import { ReceiptService } from "./receipt.service";
import { TransactionService } from "./transaction.service";

/**
 * The financial domain, self-contained.
 *
 * Everything it needs from the rest of the application it takes through the
 * global `DbModule` and `AuditModule`; nothing outside reaches into it except
 * through the exported services. That boundary is what makes the later
 * integrations the brief anticipates — online payments, accounting export,
 * invoicing, a second campus — additions inside this folder rather than changes
 * spread across the app.
 *
 * The dependency order runs one way: settings feed the revenue engine, the
 * engine feeds payments and payroll, and those feed the dashboard, analytics and
 * reports. No service reaches back up.
 */
@Module({
  imports: [AuditModule],
  controllers: [FinancialController, BrandingController],
  providers: [
    FinancialSettingsService,
    RevenueCalculationService,
    ReceiptNumberService,
    PaymentService,
    PayrollService,
    PayrollDocumentService,
    AnalyticsService,
    FinancialService,
    FinancialReportService,
    FinancialExportService,
    ReceiptService,
    TransactionService,
  ],
  exports: [
    // Exported for the students module, which bills a student on creation, and
    // for the main dashboard's summary card.
    PaymentService,
    FinancialService,
    RevenueCalculationService,
  ],
})
export class FinancialModule {}
