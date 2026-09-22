/**
 * Meta Graph API error classification.
 *
 * Verified reference: Graph API returns OAuthException `code: 190` for invalid
 * access tokens. `error_subcode: 460` specifically means the session was
 * invalidated because the user changed their password or Facebook invalidated
 * the session for security reasons — the exact production error observed on
 * /api/media. Subcodes 463 (expired) and 467 (invalid) are the other
 * re-authorization cases. None of these are recoverable by retrying: the user
 * must run the OAuth flow again to mint a new Page access token.
 */

export type MetaGraphErrorBody = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

/** Subcodes of code 190 that always require a fresh OAuth authorization. */
const REAUTH_SUBCODES = new Set([458, 459, 460, 463, 464, 467, 492]);

export class MetaGraphError extends Error {
  public readonly code?: number;
  public readonly subcode?: number;
  public readonly type?: string;
  public readonly status?: number;

  constructor(body: MetaGraphErrorBody | undefined, fallback: string, status?: number) {
    super(body?.message || fallback);
    this.name = 'MetaGraphError';
    this.code = body?.code;
    this.subcode = body?.error_subcode;
    this.type = body?.type;
    this.status = status;
  }

  /** True when the stored token can never work again and OAuth must be re-run. */
  public get requiresReauthorization(): boolean {
    if (this.code === 190) return true;
    if (this.code === 102 || this.code === 463 || this.code === 467) return true;
    if (this.type === 'OAuthException' && this.subcode && REAUTH_SUBCODES.has(this.subcode)) return true;
    return false;
  }
}

/**
 * Classifies any thrown value. Used so callers can distinguish a permanently
 * invalid token (mark connection, prompt reconnect) from a transient Meta
 * outage (keep the connection CONNECTED and keep serving cache).
 */
export function metaErrorRequiresReauthorization(error: unknown): boolean {
  if (error instanceof MetaGraphError) return error.requiresReauthorization;
  if (error instanceof Error) {
    // Defensive: some call paths only carry the human-readable message.
    return /session has been invalidated|access token.*(expired|invalid)|Error validating access token/i.test(error.message);
  }
  return false;
}

/** A short, non-sensitive summary safe to store and show in the dashboard. */
export function describeMetaError(error: unknown): string {
  if (error instanceof MetaGraphError) {
    const parts = [error.message];
    if (error.code !== undefined) parts.push(`(code ${error.code}${error.subcode !== undefined ? `, subcode ${error.subcode}` : ''})`);
    return parts.join(' ').slice(0, 300);
  }
  return (error instanceof Error ? error.message : 'Instagram sync failed').slice(0, 300);
}
