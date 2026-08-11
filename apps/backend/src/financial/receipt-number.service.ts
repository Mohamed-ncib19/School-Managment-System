import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DbService, Tx } from "../db/db.service";
import { receiptCounters } from "../db/schema";
import { FinancialSettingsService } from "./financial-settings.service";

export type ReceiptKind = "payment" | "payroll" | "settlement";

/**
 * Issues the human-readable receipt numbers printed on quittances.
 *
 * These are the numbers a parent quotes when they query a payment, so they have
 * to be unique, gapless within a year, and never reused. The counter therefore
 * lives in the database rather than being derived from `COUNT(*)`: two cashiers
 * recording a payment in the same second would both read the same count and mint
 * the same number, and a later refund would make the count go backwards.
 *
 * `next()` must be called with the transaction client of the write it belongs
 * to. The `UPDATE ... RETURNING` takes a row lock for the rest of that
 * transaction, so concurrent collections serialise on the counter and each gets
 * its own number — and if the surrounding write rolls back, the number is
 * released with it.
 */
@Injectable()
export class ReceiptNumberService {
  constructor(
    private readonly db: DbService,
    private readonly settings: FinancialSettingsService,
  ) {}

  /**
   * Reserves the next number for `kind` in the year of `when`.
   *
   * @param tx the transaction client of the enclosing write — not the bare
   *           DbService, or the counter and the receipt can diverge.
   */
  async next(
    tx: Tx,
    kind: ReceiptKind,
    when: Date = new Date(),
  ): Promise<string> {
    const settings = await this.settings.get();
    const year = when.getFullYear();
    const scope = `${kind}:${year}`;

    // Atomic read-modify-write: upsert increments under the row lock, so the
    // value returned is this caller's alone.
    const [counter] = await tx
      .insert(receiptCounters)
      .values({ scope, value: 1 })
      .onConflictDoUpdate({
        target: receiptCounters.scope,
        set: { value: sql`${receiptCounters.value} + 1` },
      })
      .returning({ value: receiptCounters.value });

    const format =
      kind === "payroll"
        ? settings.payroll_receipt_format
        : kind === "settlement"
          ? settings.settlement_receipt_format
          : settings.receipt_number_format;
    return this.render(format, counter.value, when);
  }

  /**
   * Expands the configured template.
   *
   * Supported tokens: `{YYYY}` `{YY}` `{MM}` `{SEQ}` (zero-padded to 4) and
   * `{SEQ:n}` for a different width. Anything else is left alone, so a prefix
   * containing braces cannot break numbering.
   */
  render(format: string, sequence: number, when: Date): string {
    const year = when.getFullYear();
    const month = String(when.getMonth() + 1).padStart(2, "0");

    return format
      .replace(/\{YYYY\}/g, String(year))
      .replace(/\{YY\}/g, String(year).slice(-2))
      .replace(/\{MM\}/g, month)
      .replace(/\{SEQ:(\d+)\}/g, (_, width: string) =>
        String(sequence).padStart(Math.min(Number(width), 12), "0"),
      )
      .replace(/\{SEQ\}/g, String(sequence).padStart(4, "0"));
  }

  /** Sample output for the settings screen, without consuming a number. */
  preview(format: string): string {
    return this.render(format, 1, new Date());
  }
}