type AuthLogOperation =
  | 'login'
  | 'admin_login'
  | 'registration'
  | 'admin_setup'
  | 'password_reset'
  | 'password_recovery'
  | 'meta_oauth_start'
  | 'meta_oauth_disconnect'
  | 'meta_oauth_callback'
  | 'meta_media_sync'
  | 'admin_meta_debug';

/**
 * Authentication errors can contain submitted credentials, cookies, database
 * connection strings, provider tokens, or secret-bearing URLs. Log only a
 * fixed operation name and a safe error category/code, never the error itself.
 */
export function logAuthFailure(operation: AuthLogOperation, error: unknown) {
  const errorCode = error instanceof Error && 'code' in error ? error.code : undefined;
  const prismaCode = typeof errorCode === 'string' && /^P\d{4}$/.test(errorCode)
    ? errorCode
    : null;

  console.error(`[auth:${operation}] request failed`, {
    category: prismaCode ? 'database_error' : error instanceof Error ? 'internal_error' : 'unknown_error',
    ...(prismaCode ? { prismaCode } : {}),
  });
}
