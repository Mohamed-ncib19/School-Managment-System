import Decimal from "decimal.js";

/**
 * Money arithmetic for the financial domain.
 *
 * Everything monetary in this module is a `Decimal`, never a JS number.
 * A float cannot hold 0.1 exactly, so a percentage split done in floats drifts
 * by a millime here and there — invisible per row, and impossible to reconcile
 * once a year of collections has accumulated.
 *
 * Drizzle/node-postgres hand numerics back as strings; `money()` coerces
 * anything into a Decimal and `toDb()` serialises back for writes.
 */

export type Money = Decimal;

export const ZERO = new Decimal(0);

/** Coerces anything the database or an HTTP body might hand us into a Decimal. */
export function money(value: Decimal | string | number | null | undefined): Money {
  if (value === null || value === undefined) return ZERO;
  if (value instanceof Decimal) return value;
  return new Decimal(value);
}

/**
 * Rounds to millimes (2dp), half away from zero.
 *
 * Half-up is what a cashier does and what the receipt has to agree with; it is
 * also symmetric about zero, so refunding a payment returns exactly what was
 * taken rather than a millime more or less.
 */
export function round2(value: Money): Money {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Serialises a Money back to the fixed-point string the DB expects. */
export function toDb(value: Money | string | number | null | undefined): string {
  return round2(money(value)).toFixed(2);
}

export function sum(values: Money[]): Money {
  return values.reduce<Money>((acc, v) => acc.plus(v), ZERO);
}

export function isZero(value: Money): boolean {
  return value.isZero();
}

/** Serialises for JSON responses without ever going through a float. */
export function toAmount(value: Money | string | number | null | undefined): string {
  return round2(money(value)).toFixed(2);
}

/**
 * Percentage of an amount, rounded to millimes.
 * `pct` is 0-100, not a fraction.
 */
export function percentOf(amount: Money, pct: Money): Money {
  return round2(amount.times(pct).dividedBy(100));
}

/** Guards against a divide-by-zero when a rate has no denominator yet. */
export function safeDivide(numerator: Money, denominator: Money): Money {
  if (denominator.isZero()) return ZERO;
  return numerator.dividedBy(denominator);
}

/** Collection rate as a 0-100 percentage, rounded to 1dp. */
export function ratePercent(collected: Money, expected: Money): number {
  if (expected.isZero()) return 0;
  return Number(collected.dividedBy(expected).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP));
}