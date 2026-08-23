/**
 * Which driver failures are worth trying again.
 *
 * `withRetry` used to retry everything, so a typo'd bucket name or a revoked
 * key spent four attempts and up to two and a half minutes of 30-second
 * timeouts before the setup wizard could say what was wrong. Permanent
 * failures should surface immediately and precisely; only transient ones earn
 * a backoff.
 *
 * Unrecognised errors are treated as transient. Retrying something permanent
 * costs time; giving up on something transient costs a backup.
 */
const PERMANENT_NAMES = new Set([
  "InvalidAccessKeyId",
  "SignatureDoesNotMatch",
  "NoSuchBucket",
  "AccessDenied",
  "AuthorizationHeaderMalformed",
  "InvalidBucketName",
  "PermanentRedirect",
]);

const PERMANENT_STATUS = new Set([400, 401, 403, 404, 405, 409, 501]);

export function isRetryable(err: unknown): boolean {
  const e = err as {
    name?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
    response?: { status?: number };
    status?: number;
  };

  if (e?.name && PERMANENT_NAMES.has(e.name)) return false;

  const status = e?.$metadata?.httpStatusCode ?? e?.response?.status ?? e?.status;
  if (typeof status === "number") {
    // 429 and 5xx are the classic retryable pair; everything in
    // PERMANENT_STATUS will fail identically however many times we ask.
    if (PERMANENT_STATUS.has(status)) return false;
    return true;
  }

  const message = e?.message ?? String(err);
  if (/invalid_grant|invalid credentials|unauthorized|forbidden/i.test(message)) return false;
  return true;
}
