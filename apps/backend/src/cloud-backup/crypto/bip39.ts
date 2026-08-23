import { createHash, randomBytes } from "node:crypto";
import { BIP39_WORDS } from "./bip39-words";

/**
 * Recovery phrase generation.
 *
 * A genuine BIP39 12-word mnemonic: 128 bits of CSPRNG entropy plus a 4-bit
 * SHA256 checksum, so a transcription error is detected by the phrase itself
 * before it even reaches the cloud. The admin never types a phrase of their
 * own choosing — a human-picked phrase is a weak passphrase by construction,
 * and this subsystem's entire threat model stands on the phrase's entropy.
 */
export interface RecoveryPhrase {
  words: string[];
  /** Lowercase words joined by a single space, the canonical form. */
  phrase: string;
  /** The phrase, formatted for printing in a 3x4 grid. */
  grid: string[];
}

const ENTROPY_BITS = 128;
const WORDS_COUNT = 12;
const BITS_PER_WORD = 11;

export function generateRecoveryPhrase(): RecoveryPhrase {
  const entropy = randomBytes(ENTROPY_BITS / 8);
  const checksumBits = ENTROPY_BITS / 32;

  const hash = createHash("sha256").update(entropy).digest();
  const bits: boolean[] = [];
  for (const byte of entropy) {
    for (let i = 7; i >= 0; i--) bits.push(((byte >> i) & 1) === 1);
  }
  for (let i = 0; i < checksumBits; i++) {
    bits.push(((hash[0] >> (7 - i)) & 1) === 1);
  }

  const words: string[] = [];
  for (let i = 0; i < WORDS_COUNT; i++) {
    let index = 0;
    for (let j = 0; j < BITS_PER_WORD; j++) {
      index = (index << 1) | (bits[i * BITS_PER_WORD + j] ? 1 : 0);
    }
    words.push(BIP39_WORDS[index]);
  }

  return {
    words,
    phrase: words.join(" "),
    grid: [
      [0, 1, 2].map((n) => words[n]).join(" "),
      [3, 4, 5].map((n) => words[n]).join(" "),
      [6, 7, 8].map((n) => words[n]).join(" "),
      [9, 10, 11].map((n) => words[n]).join(" "),
    ],
  };
}

/**
 * True when the string is a structurally valid 12-word BIP39 phrase (known
 * words + correct checksum). Used to reject a mangled entry before any key
 * derivation work.
 */
export function isValidRecoveryPhrase(input: string): boolean {
  const words = normalizePhrase(input).split(" ");
  if (words.length !== WORDS_COUNT) return false;
  if (words.some((w) => !BIP39_WORDS.includes(w))) return false;

  const bits: boolean[] = [];
  for (const word of words) {
    const index = BIP39_WORDS.indexOf(word);
    for (let i = BITS_PER_WORD - 1; i >= 0; i--) bits.push(((index >> i) & 1) === 1);
  }

  const entropyBits = bits.slice(0, ENTROPY_BITS);
  const checksumBits = bits.slice(ENTROPY_BITS);

  const entropy = Buffer.alloc(ENTROPY_BITS / 8);
  for (let i = 0; i < entropyBits.length; i++) {
    if (entropyBits[i]) entropy[Math.floor(i / 8)] |= 1 << (7 - (i % 8));
  }
  const hash = createHash("sha256").update(entropy).digest();
  for (let i = 0; i < checksumBits.length; i++) {
    const expected = ((hash[0] >> (7 - i)) & 1) === 1;
    if (checksumBits[i] !== expected) return false;
  }
  return true;
}

/** Collapse whitespace and case so "Abandon Able …" and pasted line breaks work. */
export function normalizePhrase(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).join(" ");
}