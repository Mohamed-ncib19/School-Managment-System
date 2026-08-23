/**
 * The known-plaintext object that proves a recovery phrase opens a backup.
 *
 * Setup encrypts this and stores it at `{school_id}/meta/check.json.enc`;
 * restore decrypts it with the key derived from the typed phrase and compares
 * byte-for-byte. Both sides MUST build it here — the two call sites drifted
 * once already (setup omitted `school_id`, restore required it), which made
 * every restore reject a perfectly valid phrase.
 *
 * Key order is part of the format: these bytes are compared with `!==`, not
 * parsed. Never reorder the fields, and never add one without bumping
 * FORMAT_VERSION and teaching restore to accept both shapes.
 */
export function buildCheckPlaintext(schoolId: string): string {
  return JSON.stringify({
    school_id: schoolId,
    purpose: "recovery-phrase-verification",
    known_plaintext: "cette phrase ouvre cette sauvegarde",
  });
}
