import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  Query,
  Request,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { PaymentsService } from "./payments.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { RecordPaymentDto, UpdatePaymentStatusDto } from "./dto/record-payment.dto";

@Controller("payments")
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  async findAll(@Query() filters: {
    status?: string;
    groupId?: string;
    levelId?: string;
    profId?: string;
    fieldId?: string;
  }) {
    return this.paymentsService.getPayments(filters);
  }

  @Get("student/:studentId")
  async getStudentHistory(@Param("studentId", ParseUUIDPipe) studentId: string) {
    return this.paymentsService.getPaymentHistory(studentId);
  }

  @Post("generate")
  async generateMonthly(@Request() req: any) {
    return this.paymentsService.generateMonthlyPayments();
  }

  @Post("generate-for-student/:studentId")
  async generateForStudent(@Param("studentId", ParseUUIDPipe) studentId: string, @Request() req: any) {
    return this.paymentsService.generatePaymentForStudent(studentId);
  }

  @Post("update-status-for-student/:studentId")
  async updateStatusForStudent(@Param("studentId", ParseUUIDPipe) studentId: string, @Request() req: any) {
    return this.paymentsService.updatePaymentStatusesForStudent(studentId);
  }

  @Post(":id/record-payment")
  async recordPayment(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
    @Request() req: any,
  ) {
    return this.paymentsService.recordPayment(id, req.user.id, dto);
  }

  @Get(":id/receipt")
  async getReceipt(
    @Param("id", ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const html = await this.paymentsService.generateReceipt(id);
    res.set({ "Content-Type": "text/html; charset=utf-8" });
    res.send(html);
  }

  @Patch(":id/status")
  async updateStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentStatusDto,
    @Request() req: any,
  ) {
    return this.paymentsService.updatePaymentStatus(id, req.user.id, dto.status);
  }
}
