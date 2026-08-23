import { LoggerService } from "@nestjs/common";

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
  { re: /\b[0-9A-Za-z+/]{40}\b/g, label: "[redacted-secret]" },
  // JWT / session cookies
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, label: "[redacted-jwt]" },
  // Recovery phrases: 12 lowercase space-separated words that are all in the
  // BIP39 set — extremely unlikely to match anything else in a log line.
  { re: /\b(?:[a-z]{3,8}\s){11}[a-z]{3,8}\b/g, label: "[redacted-recovery-phrase]" },
];

export function redactLog(input: string): string {
  if (!input) return input;
  let out = input;
  for (const { re, label } of SECRET_PATTERNS) {
    out = out.replace(re, label);
  }
  return out;
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
    // eslint-disable-next-line no-console
    console[level === "fatal" ? "error" : level === "log" ? "log" : "log"](
      `${color}[${this.context ?? "cloud-backup"}] ${redactLog(line)}${reset}`,
    );
  }
}