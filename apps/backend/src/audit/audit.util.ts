/**
 * Reduces an update to just the fields whose value actually changed, paired as
 * before/after.
 *
 * Storing the whole DTO as "new values" makes the trail noisy and misleading:
 * a form that submits every field makes an untouched record look rewritten.
 */
export function changedFields(
  prev: Record<string, any> | null | undefined,
  next: Record<string, any> | null | undefined,
): { prevValues: Record<string, unknown>; newValues: Record<string, unknown>; changed: string[] } {
  const prevValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  const changed: string[] = [];

  for (const [key, after] of Object.entries(next ?? {})) {
    if (after === undefined) continue;
    const before = prev?.[key];

    // Compared as strings so Decimal/Date/number-vs-string do not read as edits.
    const same =
      before === after ||
      (before instanceof Date && after instanceof Date && before.getTime() === after.getTime()) ||
      (before !== null && before !== undefined && after !== null && String(before) === String(after));

    if (same) continue;

    prevValues[key] = before ?? null;
    newValues[key] = after;
    changed.push(key);
  }

  return { prevValues, newValues, changed };
}

/** Compact human label for an audited row, used for search and display. */
export function labelOf(entity: Record<string, any> | null | undefined): string | null {
  if (!entity) return null;
  if (entity.full_name) return String(entity.full_name);
  if (entity.first_name || entity.last_name) {
    return `${entity.first_name ?? ""} ${entity.last_name ?? ""}`.trim();
  }
  if (entity.name) return String(entity.name);
  if (entity.email) return String(entity.email);
  return null;
}
