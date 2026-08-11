import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response, Request } from "express";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard, Roles } from "../auth/guards/roles.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { FinancialService } from "./financial.service";
import { PaymentService } from "./payment.service";
import { PayrollService } from "./payroll.service";
import { PayrollDocumentService } from "./payroll-document.service";
import { AnalyticsService } from "./analytics.service";
import { FinancialReportService } from "./financial-report.service";
import { FinancialExportService } from "./financial-export.service";
import { FinancialSettingsService } from "./financial-settings.service";
import { ReceiptService } from "./receipt.service";
import { TransactionService } from "./transaction.service";
import { RevenueCalculationService } from "./revenue-calculation.service";
import { ReceiptNumberService } from "./receipt-number.service";
import { money } from "./money.util";
import { validateFormula } from "./formula.util";
import { FinancialQueryDto, ReportQueryDto, TransactionQueryDto, type Dimension } from "./dto/analytics.dto";
import {
  CancelPaymentDto,
  CorrectTransactionDto,
  PaymentQueryDto,
  RecordTransactionDto,
  RefundTransactionDto,
  UpdatePaymentStatusDto,
} from "./dto/payment.dto";
import { PayrollQueryDto, RecordPayrollDto, UpdatePayrollDto, UpsertCompensationDto } from "./dto/payroll.dto";
import { UpdateFinancialSettingsDto } from "./dto/financial-settings.dto";

/**
 * Everything financial, under `/api/financial`.
 *
 * The whole surface is `super_admin` only ΓÇö the academy's books are not
 * something the role model currently opens to anyone else. `RolesGuard` reads
 * the class-level decorator, so a route added here inherits that by default
 * rather than by remembering to annotate it.
 */
@ApiTags("financial")
@ApiBearerAuth()
@Controller("financial")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin")
export class FinancialController {
  constructor(
    private readonly financial: FinancialService,
    private readonly payments: PaymentService,
    private readonly payroll: PayrollService,
    private readonly analytics: AnalyticsService,
    private readonly reports: FinancialReportService,
    private readonly exports: FinancialExportService,
    private readonly settings: FinancialSettingsService,
    private readonly receipts: ReceiptService,
    private readonly transactions: TransactionService,
    private readonly revenue: RevenueCalculationService,
    private readonly receiptNumbers: ReceiptNumberService,
    private readonly payrollDocuments: PayrollDocumentService,
  ) {}

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------

  @Get("dashboard")
  @ApiOperation({ summary: "KPI cards for the financial dashboard" })
  dashboard(@Query() query: FinancialQueryDto) {
    return this.financial.dashboard(query);
  }

  @Get("summary")
  @ApiOperation({ summary: "Compact figures for the main dashboard" })
  summary() {
    return this.financial.summary();
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  @Get("analytics/revenue")
  revenueSeries(@Query() query: FinancialQueryDto) {
    return this.analytics.revenueSeries(query);
  }

  @Get("analytics/profit")
  profitSeries(@Query() query: FinancialQueryDto) {
    return this.analytics.profitSeries(query);
  }

  @Get("analytics/collection-trend")
  collectionTrend(@Query() query: FinancialQueryDto) {
    return this.analytics.collectionTrend(query);
  }

  @Get("analytics/late-payments")
  latePayments(@Query() query: FinancialQueryDto) {
    return this.analytics.latePaymentTrend(query);
  }

  @Get("analytics/status-distribution")
  statusDistribution(@Query() query: FinancialQueryDto) {
    return this.analytics.statusDistribution(query);
  }

  @Get("analytics/professor-performance")
  professorPerformance(@Query() query: FinancialQueryDto) {
    return this.analytics.professorPerformance(query);
  }

  /**
   * Revenue grouped by one academic dimension. Each row carries the dimension a
   * click should descend into, so the chart's drill-down needs no hard-coded
   * knowledge of the hierarchy.
   */
  @Get("analytics/breakdown/:dimension")
  breakdown(@Param("dimension") dimension: Dimension, @Query() query: FinancialQueryDto) {
    return this.analytics.breakdown(dimension, query);
  }

  // ---------------------------------------------------------------------------
  // Student payments
  // ---------------------------------------------------------------------------

  @Get("payments")
  listPayments(@Query() query: PaymentQueryDto) {
    return this.payments.list(query);
  }

  @Get("payments/:id")
  findPayment(@Param("id", ParseUUIDPipe) id: string) {
    return this.payments.findOne(id);
  }

  @Get("payments/student/:studentId")
  studentHistory(@Param("studentId", ParseUUIDPipe) studentId: string) {
    return this.payments.historyForStudent(studentId);
  }

  @Post("payments/:id/transactions")
  @ApiOperation({ summary: "Take cash against an invoice; omit the amount to settle it in full" })
  async recordTransaction(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RecordTransactionDto,
    @CurrentUser("id") userId: string,
  ) {
    const result = await this.payments.recordTransaction(id, userId, dto);
    this.financial.invalidate();
    return result;
  }

  @Post("payments/:id/refund")
  async refund(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RefundTransactionDto,
    @CurrentUser("id") userId: string,
  ) {
    const result = await this.payments.refund(id, userId, dto);
    this.financial.invalidate();
    return result;
  }

  @Post("payments/:id/correct")
  async correct(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CorrectTransactionDto,
    @CurrentUser("id") userId: string,
  ) {
    const result = await this.payments.correct(id, userId, dto);
    this.financial.invalidate();
    return result;
  }

  @Patch("payments/:id/cancel")
  async cancelPayment(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CancelPaymentDto,
    @CurrentUser("id") userId: string,
  ) {
    const result = await this.payments.cancel(id, userId, dto);
    this.financial.invalidate();
    return result;
  }

  @Patch("payments/:id/reopen")
  async reopenPayment(@Param("id", ParseUUIDPipe) id: string, @CurrentUser("id") userId: string) {
    const result = await this.payments.reopen(id, userId);
    this.financial.invalidate();
    return result;
  }

  @Patch("payments/:id/status")
  @ApiOperation({ summary: "Manually set an invoice's status (validated against the ledger)" })
  async updatePaymentStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentStatusDto,
    @CurrentUser("id") userId: string,
  ) {
    const result = await this.payments.updateStatus(id, userId, dto);
    this.financial.invalidate();
    return result;
  }

  @Get("payments/:id/receipt")
  async paymentReceipt(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser("id") userId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const html = await this.receipts.forPayment(id, userId, await this.logoUrl(req));
    res.set({ "Content-Type": "text/html; charset=utf-8" });
    res.send(html);
  }

  @Post("payments/generate")
  @ApiOperation({ summary: "Bill every active student for the coming months" })
  async generateMonthly(@Query("months") months?: string) {
    const result = await this.payments.generateMonthly(months ? parseInt(months, 10) : 0);
    this.financial.invalidate();
    return result;
  }

  @Post("payments/generate/:studentId")
  async generateForStudent(
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Query("months") months?: string,
  ) {
    const result = await this.payments.generateForStudent(
      studentId,
      months ? parseInt(months, 10) : 0,
    );
    this.financial.invalidate();
    return result;
  }

  @Post("payments/refresh-statuses")
  async refreshStatuses(@Query("studentId") studentId?: string) {
    const result = await this.payments.refreshStatuses(studentId);
    this.financial.invalidate();
    return result;
  }

  // ---------------------------------------------------------------------------
  // Payroll
  // ---------------------------------------------------------------------------

  @Get("payroll")
  listPayroll(@Query() query: PayrollQueryDto) {
    return this.payroll.list(query);
  }

  @Get("payroll/professor/:profId")
  professorDetail(
    @Param("profId", ParseUUIDPipe) profId: string,
    @Query("period") period?: string,
  ) {
    return this.payroll.detail(profId, period);
  }

  @Post("payroll/professor/:profId/pay")
  async recordPayroll(
    @Param("profId", ParseUUIDPipe) profId: string,
    @Body() dto: RecordPayrollDto,
    @CurrentUser("id") userId: string,
  ) {
    const result = await this.payroll.recordPayment(profId, userId, dto);
    this.financial.invalidate();
    return result;
  }

  @Patch("payroll/payment/:payoutId")
  async updatePayroll(
    @Param("payoutId", ParseUUIDPipe) payoutId: string,
    @Body() dto: UpdatePayrollDto,
    @CurrentUser("id") userId: string,
  ) {
    const result = await this.payroll.updatePayment(payoutId, userId, dto);
    this.financial.invalidate();
    return result;
  }

  @Delete("payroll/payment/:payoutId")
  async deletePayroll(
    @Param("payoutId", ParseUUIDPipe) payoutId: string,
    @Query("reason") reason: string,
    @CurrentUser("id") userId: string,
  ) {
    await this.payroll.removePayment(payoutId, userId, reason ?? "No reason given");
    this.financial.invalidate();
    return { deleted: true };
  }

  @Get("payroll/payment/:payoutId/receipt")
  async payrollReceipt(
    @Param("payoutId", ParseUUIDPipe) payoutId: string,
    @CurrentUser("id") userId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const html = await this.receipts.forPayroll(payoutId, userId, await this.logoUrl(req));
    res.set({ "Content-Type": "text/html; charset=utf-8" });
    res.send(html);
  }

  // ---------------------------------------------------------------------------
  // Payroll settlement documents
  // ---------------------------------------------------------------------------

  /**
   * The full settlement picture for a professor and period ΓÇö the same snapshot
   * the printed documents are rendered from, so the screen's breakdown bar and
   * the paper can never disagree about what was settled.
   */
  @Get("payroll/professor/:profId/settlement")
  settlement(
    @Param("profId", ParseUUIDPipe) profId: string,
    @Query("period") period?: string,
  ) {
    return this.payrollDocuments.settlementForPeriod(profId, period);
  }

  @Get("payroll/payment/:payoutId/documents")
  payoutDocuments(@Param("payoutId", ParseUUIDPipe) payoutId: string) {
    return this.payrollDocuments.listForPayout(payoutId);
  }

  @Get("payroll/professor/:profId/documents")
  professorDocuments(
    @Param("profId", ParseUUIDPipe) profId: string,
    @Query("period") period?: string,
  ) {
    return this.payrollDocuments.listForProfessor(profId, period ?? undefined);
  }

  /** Re-issues the pair of documents for a payout, e.g. after a correction. */
  @Post("payroll/payment/:payoutId/documents/regenerate")
  async regenerateDocuments(
    @Param("payoutId", ParseUUIDPipe) payoutId: string,
    @CurrentUser("id") userId: string,
  ) {
    const rows = await this.payrollDocuments.regenerate(payoutId, userId);
    return { generated: rows.map((row: { id: string }) => row.id) };
  }

  /** The print-ready A4 document (browser print ΓåÆ PDF). */
  @Get("payroll/document/:docId")
  async renderDocument(
    @Param("docId", ParseUUIDPipe) docId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const html = await this.payrollDocuments.render(docId, await this.logoUrl(req));
    res.set({ "Content-Type": "text/html; charset=utf-8" });
    res.send(html);
  }

  @Put("payroll/professor/:profId/compensation")
  async upsertCompensation(
    @Param("profId", ParseUUIDPipe) profId: string,
    @Body() dto: UpsertCompensationDto,
    @CurrentUser("id") userId: string,
  ) {
    const result = await this.payroll.upsertCompensation(profId, userId, dto);
    this.financial.invalidate();
    return result;
  }

  @Delete("payroll/professor/:profId/compensation")
  async removeCompensation(
    @Param("profId", ParseUUIDPipe) profId: string,
    @CurrentUser("id") userId: string,
  ) {
    await this.payroll.removeCompensation(profId, userId);
    this.financial.invalidate();
    return { removed: true };
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  @Get("transactions")
  ledger(@Query() query: TransactionQueryDto) {
    return this.transactions.ledger(query);
  }

  @Get("transactions/activity")
  activity(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("action") action?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("search") search?: string,
  ) {
    return this.transactions.activity({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      action,
      from,
      to,
      search,
    });
  }

  @Get("transactions/activity/actions")
  activityActions() {
    return this.transactions.activityActions();
  }

  // ---------------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------------

  @Get("reports")
  report(@Query() query: ReportQueryDto) {
    return this.reports.generate(query);
  }

  /**
   * The same report as a file. Streams rather than returning the envelope, so
   * the browser sees a download.
   */
  @Get("reports/export")
  async exportReport(@Query() query: ReportQueryDto, @Res() res: Response) {
    const report = await this.reports.generate(query);
    const file = await this.exports.export(report, query.format ?? "csv");

    res.set({
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
    });
    res.send(file.body);
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  @Get("settings")
  getSettings() {
    return this.settings.get();
  }

  @Patch("settings")
  updateSettings(@Body() dto: UpdateFinancialSettingsDto, @CurrentUser("id") userId: string) {
    this.financial.invalidate();
    return this.settings.update(dto, userId);
  }

  /** Parse-checks a formula so the settings screen can reject a typo at save time. */
  @Post("settings/validate-formula")
  validateFormulaEndpoint(@Body("formula") formula: string) {
    return validateFormula(formula ?? "");
  }

  /** Sample receipt number for a candidate format, without consuming one. */
  @Post("settings/preview-receipt-format")
  previewReceiptFormat(@Body("format") format: string) {
    return { sample: this.receiptNumbers.preview(format ?? "REC-{YYYY}-{SEQ}") };
  }

  /**
   * Worked example of a compensation rule ΓÇö the "student pays 100, professor
   * gets 60" panel on the settings screen.
   */
  @Post("settings/preview-split")
  previewSplit(
    @Body()
    body: {
      amount?: string;
      model?: any;
      percentage?: string;
      fixed_amount?: string;
      custom_formula?: string;
      student_count?: number;
      group_count?: number;
    },
  ) {
    const split = this.revenue.preview(
      {
        model: body.model ?? "percentage",
        percentage: body.percentage ? money(body.percentage) : null,
        fixedAmount: body.fixed_amount ? money(body.fixed_amount) : null,
        customFormula: body.custom_formula ?? null,
      },
      money(body.amount ?? "100"),
      { studentCount: body.student_count ?? 0, groupCount: body.group_count ?? 0 },
    );

    return {
      amount: money(body.amount ?? "100").toFixed(2),
      professor_share: split.professorShare.toFixed(2),
      school_share: split.schoolShare.toFixed(2),
      fixed_component: split.fixedComponent.toFixed(2),
    };
  }

  /**
   * The absolute URL of the uploaded logo, cache-busted by its last change ΓÇö
   * null when no logo is set. The printed HTML opens in a bare tab (no auth
   * header), so the image URL must be absolute and public.
   */
  private async logoUrl(req: Request): Promise<string | null> {
    const current = await this.settings.get();
    if (!current.logo_path) return null;
    const base = `${req.protocol}://${req.get("host")}`;
    return `${base}${current.logo_path}?v=${new Date(current.updated_at).getTime()}`;
  }
}
