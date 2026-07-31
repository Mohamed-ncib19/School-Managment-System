import { IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Decorators are load-bearing, not documentation: the global ValidationPipe runs
 * with `whitelist: true`, which strips any property that carries no validation
 * decorator. An undecorated DTO arrives empty.
 */
export class RecordPaymentDto {
  /**
   * Optional — omitted means "the full amount due", which is the only value
   * Phase 1 accepts anyway (partial payments are out of scope; the service
   * rejects anything that isn't equal to `amount_due`).
   *
   * Kept as a string all the way to Prisma so the decimal is never round-tripped
   * through a float. The transform is for clients that send a JSON number.
   */
  @ApiPropertyOptional({ example: "500.00" })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === undefined ? value : String(value)))
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: "paid_amount must be a positive number with at most 2 decimal places",
  })
  paid_amount?: string;

  @ApiPropertyOptional({ example: "Paid in cash at the front desk" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdatePaymentStatusDto {
  /**
   * `paid` is deliberately not accepted here. Flipping the column on its own
   * would leave a row marked paid with no `paid_at`, no `paid_amount` and no
   * `recorded_by` — a cash collection nobody is accountable for. Recording a
   * payment goes through POST /payments/:id/record-payment.
   */
  @ApiProperty({ enum: ["not_paid", "due_soon", "overdue"] })
  @Matches(/^(not_paid|due_soon|overdue)$/, {
    message:
      "status must be one of: not_paid, due_soon, overdue. To mark a payment paid, use POST /payments/:id/record-payment",
  })
  status!: "not_paid" | "due_soon" | "overdue";
}
