import { LoggerService } from "@nestjs/common";
import { BIP39_WORDS } from "../crypto/bip39-words";

const BIP39_SET = new Set<string>(BIP39_WORDS);

/**
 * Log redaction for the cloud-backup subsystem.
 *
 * Credentials, recovery phrases and tokens must never reach logs, crash
 * reports or telemetry. This filter scrubs known secret shapes from any string
 * before it is logged. It is applied at the cloud-backup boundary (every log
 * line the subsystem emits) and exported for unit testing.
 */

const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // Key: value pairs for known secret keys (JSON, query strings, log lines).
  { re: /(secret[_ ]?access[_ ]?key|client[_ ]?secret|refresh[_ ]?token|access[_ ]?token|password|passwd|authorization)\s*"?\s*[:=]\s*"?[^,}\s]+"?/gi, label: "$1=[redacted]" },
  // Bearer / Basic authorization headers
  { re: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, label: "$1 [redacted]" },
  // AWS-style access key IDs (AKIA…20 chars) and secrets (40 chars base64)
  { re: /\b(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16})\b/g, label: "[redacted-akid]" },
  // An AWS secret is 40 chars AND mixes character classes AND is not pure
  // hex. The old rule was length alone, which redacted every SHA-1 digest and
  // commit id that appeared in a log line.
  {
    re: /\b(?![0-9a-f]{40}\b)(?=[A-Za-z0-9+/]{40}\b)(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]{40}\b/g,
    label: "[redacted-secret]",
  },
  // JWT / session cookies
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, label: "[redacted-jwt]" },
];

/**
 * A run of twelve lowercase words is redacted only when EVERY word is in the
 * BIP39 list.
 *
 * Matching on shape alone (`(?:[a-z]{3,8}\s){11}[a-z]{3,8}`) redacted ordinary
 * French log sentences — a safety feature that quietly became a legibility
 * bug.
 */
function redactRecoveryPhrases(input: string): string {
  return input.replace(/\b(?:[a-z]{3,8}\s+){11}[a-z]{3,8}\b/g, (match) =>
    match.split(/\s+/).every((word) => BIP39_SET.has(word)) ? "[redacted-recovery-phrase]" : match,
  );
}

export function redactLog(input: string): string {
  if (!input) return input;
  let out = input;
  for (const { re, label } of SECRET_PATTERNS) {
    out = out.replace(re, label);
  }
  return redactRecoveryPhrases(out);
}

export function redactLogError(err: unknown): string {
  if (err instanceof Error) {
    return redactLog(err.message);
  }
  return redactLog(String(err));
}

/** LoggerService wrapper that redacts every line it writes. */
export class RedactingLogger implements LoggerService {
  constructor(private readonly context?: string) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write("log", message, optionalParams);
  }
  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write("error", message, optionalParams);
  }
  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write("warn", message, optionalParams);
  }
  debug?(message: unknown, ...optionalParams: unknown[]): void {
    this.write("debug", message, optionalParams);
  }
  verbose?(message: unknown, ...optionalParams: unknown[]): void {
    this.write("verbose", message, optionalParams);
  }
  fatal?(message: unknown, ...optionalParams: unknown[]): void {
    this.write("fatal", message, optionalParams);
  }

  private write(level: string, message: unknown, optionalParams: unknown[]): void {
    const text = typeof message === "string" ? message : JSON.stringify(message) ?? String(message);
    const meta = optionalParams.map((p) =>
      typeof p === "string" ? p : JSON.stringify(p) ?? String(p),
    );
    const line = [text, ...meta].join(" ");
    const color =
      level === "error" ? "\x1b[31m" : level === "warn" ? "\x1b[33m" : level === "debug" ? "\x1b[36m" : "";
    const reset = "\x1b[0m";
    // The old ternary resolved to console.log for EVERY level, so errors and
    // warnings never reached stderr and were invisible to log capture.
    const sink =
      level === "error" || level === "fatal"
        ? console.error
        : level === "warn"
          ? console.warn
          : console.log;
    // eslint-disable-next-line no-console
    sink(`${color}[${this.context ?? "cloud-backup"}] ${redactLog(line)}${reset}`);
  }
}