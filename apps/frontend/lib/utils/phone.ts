/**
 * Local phone format: +216 (Tunisia) followed by exactly 8 digits.
 */
export const TUNISIA_PHONE_PATTERN = /^\+216\d{8}$/;

export const TUNISIA_PHONE_PLACEHOLDER = "+216 22 123 456";

/**
 * Normalizes a phone number to the local format (+216 + 8 digits).
 * Accepts 8 digits with an optional leading 0, a bare "216" prefix, or the
 * full "+216" prefix, ignoring spaces, dashes, dots and parentheses.
 * Returns null when the value cannot be interpreted as such a number.
 */
export function normalizeTunisianPhone(value: string): string | null {
  let core = value.replace(/[\s().\-_]/g, "");
  if (core.startsWith("+216")) core = core.slice(4);
  else if (core.startsWith("216")) core = core.slice(3);
  else if (core.startsWith("0")) core = core.slice(1);
  if (!/^\d{8}$/.test(core)) return null;
  return `+216${core}`;
}
