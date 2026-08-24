/**
 * The school's namespace id, derived from the name it already has.
 *
 * The wizard used to ask an administrator to invent this, with rules: three
 * to sixty-four characters, lowercase, digits and hyphens. That is a question
 * about a database namespace dressed up as a question about their school, and
 * it is the kind of field people stall on. The install already knows the
 * school's name (`system_settings.system_name`), so the id can simply be
 * derived and shown — editable, but answered.
 *
 * It matters for one thing only: it is what the administrator types on a new
 * computer during a restore, alongside the recovery phrase. So it has to stay
 * readable and memorable — "iq-academy", not a UUID.
 */

const MIN = 3;
const MAX = 64;

/** Start and end of the Unicode "Combining Diacritical Marks" block. */
const COMBINING_FIRST = 0x0300;
const COMBINING_LAST = 0x036f;

/**
 * Drops accents while keeping the letters they sit on.
 *
 * Written as a code-point scan rather than a regex character class on purpose:
 * a class containing literal combining marks is invisible in a diff and is
 * silently mangled by editors, git filters and encoding conversions. Without
 * this step "École" slugs to "e-cole", because the orphaned mark is not
 * alphanumeric and becomes a separator.
 */
function stripDiacritics(input: string): string {
  let out = "";
  for (const ch of input.normalize("NFD")) {
    const code = ch.codePointAt(0);
    if (code !== undefined && code >= COMBINING_FIRST && code <= COMBINING_LAST) continue;
    out += ch;
  }
  return out;
}

export function slugifySchoolId(name: string): string {
  const slug = stripDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX)
    .replace(/-+$/g, "");

  if (!slug) return "";
  if (slug.length >= MIN) return slug;
  // A very short name ("A") still needs a usable id.
  return `ecole-${slug}`.slice(0, MAX);
}

/** Mirrors the validation `step1` enforces, so the UI can check as you type. */
export function isValidSchoolId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{2,63}$/.test(id);
}
