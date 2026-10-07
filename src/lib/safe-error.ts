/**
 * Helpers for turning errors into short, credential-free text that is safe to
 * write to logs, AutomationRun.errorMessage, and WebhookEvent.errorDetails
 * (both of which are shown in the dashboard).
 */

export const REDACTED = '[REDACTED]';

const MAX_SAFE_MESSAGE_LENGTH = 300;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers echoed back by HTTP clients or proxies.
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`],
  // Credentials passed as query/form parameters.
  [/\b(access_token|input_token|fb_exchange_token|refresh_token|client_secret|appsecret_proof|token|password)=([^&\s"'`]+)/gi, `$1=${REDACTED}`],
  // Meta user/Page/Instagram access tokens.
  [/\b(?:EAA|IGQ|IGA)[A-Za-z0-9_-]{16,}/g, REDACTED],
  // JWTs (session cookies, OAuth state).
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  // Meta signed_request values (HMAC signature + base64url JSON payload) can
  // be replayed against the data-deletion callback, so they never reach a log.
  [/[A-Za-z0-9_-]{20,}[.]eyJ[A-Za-z0-9_-]{16,}/g, REDACTED],
  // Database connection strings carry credentials.
  [/\bpostgres(?:ql)?:\/\/[^\s"'`]+/gi, `postgresql://${REDACTED}`],
];

/** Removes known secret shapes plus any explicitly supplied secret values. */
export function redactSecrets(text: string, secrets: ReadonlyArray<string | null | undefined> = []): string {
  let result = text;
  for (const secret of secrets) {
    // Very short values would shred ordinary words; real credentials are long.
    if (typeof secret === 'string' && secret.length >= 8) result = result.split(secret).join(REDACTED);
  }
  for (const [pattern, replacement] of SECRET_PATTERNS) result = result.replace(pattern, replacement);
  return result;
}

const PRISMA_ERRORS_WITH_ARGUMENTS = new Set([
  // These embed the full client invocation, including data values such as
  // comment text, so their messages are never surfaced.
  'PrismaClientValidationError',
  'PrismaClientUnknownRequestError',
  'PrismaClientRustPanicError',
  'PrismaClientInitializationError',
]);

function finalize(text: string, secrets: ReadonlyArray<string | null | undefined>) {
  const compact = redactSecrets(text, secrets).replace(/\s+/g, ' ').trim() || 'Unknown error';
  return compact.length > MAX_SAFE_MESSAGE_LENGTH ? `${compact.slice(0, MAX_SAFE_MESSAGE_LENGTH - 1)}…` : compact;
}

/**
 * A one-line description of `error` with secrets removed. Prisma request
 * errors are reduced to their code plus the database's own message; Prisma
 * errors that echo query arguments are reduced to their class name.
 */
export function safeErrorMessage(error: unknown, secrets: ReadonlyArray<string | null | undefined> = []): string {
  if (error && typeof error === 'object') {
    const name = (error as { name?: unknown }).name;
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^P\d{4}$/.test(code)) {
      const meta = (error as { meta?: { message?: unknown } }).meta;
      const detail = typeof meta?.message === 'string' ? `: ${meta.message}` : '';
      return finalize(`Database error ${code}${detail}`, secrets);
    }
    if (typeof name === 'string' && PRISMA_ERRORS_WITH_ARGUMENTS.has(name)) {
      return `Database error (${name})`;
    }
  }
  if (error instanceof Error) return finalize(error.message || error.name, secrets);
  if (typeof error === 'string') return finalize(error, secrets);
  return 'Unknown error';
}
